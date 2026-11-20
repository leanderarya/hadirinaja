<?php

namespace Tests\Feature\S5;

use App\Enums\TenantRole;
use App\Models\Outlet;
use App\Models\User;
use App\Services\ApprovalWorkflowService;
use App\Services\CorrectionEvidenceService;
use App\Services\EffectiveAttendanceReader;
use App\Services\EmployeeOutletAssignmentService;
use App\Services\OrganizationService;
use App\Services\TenantMembershipService;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use RuntimeException;
use Tests\Support\BuildsTenantFixtures;
use Tests\TestCase;

final class CorrectionEvidenceTest extends TestCase
{
    use BuildsTenantFixtures, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        Carbon::setTestNow(CarbonImmutable::parse('2026-11-05T12:00:00Z'));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_formats_size_limit_replay_and_scope_are_enforced_with_private_downloads(): void
    {
        $fixture = $this->fixture();
        $id = (int) $fixture['request']->getKey();
        $url = '/api/v1/correction-evidence/'.$id;
        $this->getJson($url)->assertUnauthorized();
        $this->loginAs($fixture['employeeUser']);
        $this->getJson($url)->assertOk()->assertJsonCount(0, 'files')->assertJsonPath('supplement', null);
        $this->upload($id, UploadedFile::fake()->createWithContent('spoof.png', '<?php echo 1;'))->assertUnprocessable();
        $this->upload($id, UploadedFile::fake()->createWithContent('broken.pdf', "%PDF-1.4\n1 0 obj\n%%EOF\n"))->assertUnprocessable();
        $this->upload($id, UploadedFile::fake()->createWithContent('active.pdf', $this->pdf('/OpenAction [3 0 R /Fit]')))->assertUnprocessable();
        $this->upload($id, UploadedFile::fake()->createWithContent('oversize.pdf', str_repeat('x', 5242881)))->assertUnprocessable();

        $key = (string) Str::uuid();
        $jpeg = UploadedFile::fake()->image('photo.jpeg', 10, 10);
        $file = $this->upload($id, $jpeg, $key)->assertOk()->assertJsonPath('file.mime_type', 'image/jpeg')
            ->assertJsonPath('file.retention_days', 365)->json('file.id');
        $this->upload($id, $jpeg, $key)->assertOk()->assertJsonPath('file.id', $file);
        $this->upload($id, UploadedFile::fake()->image('other.png', 10, 10), $key)
            ->assertUnprocessable()->assertJsonValidationErrors('idempotency_key');

        $pdf = $this->pdf(size: 5242880);
        $pdfId = $this->upload($id, UploadedFile::fake()->createWithContent('report.pdf', $pdf))
            ->assertOk()->assertJsonPath('file.mime_type', 'application/pdf')
            ->assertJsonPath('file.size_bytes', 5242880)->json('file.id');
        $image = imagecreatetruecolor(10, 10);
        ob_start();
        imagewebp($image);
        $webp = ob_get_clean();
        $this->upload($id, UploadedFile::fake()->createWithContent('photo.webp', $webp))->assertOk()->assertJsonPath('file.mime_type', 'image/webp');
        $this->upload($id, UploadedFile::fake()->image('fourth.png', 10, 10))->assertUnprocessable()->assertJsonValidationErrors('file');
        $this->assertDatabaseCount('correction_evidence', 3);
        $this->assertSame(3, DB::table('correction_evidence_audit')->where('action', 'uploaded')->count());

        $response = $this->getJson($url.'/'.$pdfId)->assertOk()
            ->assertHeader('Content-Type', 'application/octet-stream')
            ->assertHeader('Content-Disposition', 'attachment; filename="correction-evidence-'.$pdfId.'.pdf"')
            ->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertSame(hash('sha256', $pdf), hash('sha256', $response->getContent()));
        $this->assertDatabaseHas('correction_evidence_audit', ['evidence_id' => $pdfId, 'action' => 'downloaded']);
        $this->assertArrayNotHasKey('storage_path', $this->getJson($url)->assertOk()->json('files.0'));

        [, $destination] = $this->unitWithOutlet($fixture['owner'], 'Destination unit', 'Destination only');
        [$supervisorUser, $supervisor] = $this->membershipFor($fixture['owner'], TenantRole::Supervisor);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($fixture['owner'], $supervisor, $destination);
        $this->loginAs($supervisorUser);
        $this->getJson($url)->assertForbidden();
        $this->getJson($url.'/'.$pdfId)->assertForbidden();
        $origin = Outlet::query()->findOrFail($fixture['request']->outlet_id);
        app(TenantMembershipService::class)->assignSupervisorOutletScope($fixture['owner'], $supervisor, $origin);
        $this->getJson($url.'/'.$pdfId)->assertOk();
        app(TenantMembershipService::class)->revokeSupervisorOutletScope($fixture['owner'], $supervisor, $origin);
        $this->getJson($url.'/'.$pdfId)->assertForbidden();

        [$peerUser] = $this->membershipFor($fixture['owner'], TenantRole::Employee);
        $this->loginAs($peerUser);
        $this->getJson($url)->assertForbidden();
        [$foreignUser] = $this->tenantWithOwner('Foreign evidence tenant');
        $this->loginAs($foreignUser);
        $this->getJson($url.'/'.$pdfId)->assertForbidden();
        $this->assertDatabaseHas('correction_evidence_audit', [
            'action' => 'denied', 'approval_request_id' => null, 'evidence_id' => null,
        ]);
    }

    public function test_supplement_review_and_decision_and_finalization_bindings_preserve_history(): void
    {
        $fixture = $this->fixture();
        $id = (int) $fixture['request']->getKey();
        $url = '/api/v1/correction-evidence/'.$id;
        $approval = '/api/v1/management/approvals/'.$id;
        $png = UploadedFile::fake()->image('note.png', 10, 10);
        $this->loginAs($fixture['employeeUser']);
        $this->upload($id, $png)->assertOk()->assertJsonPath('file.mime_type', 'image/png');
        $this->postJson($approval.'/evidence/requirement', ['reason' => 'Supporting statement needed.'])->assertForbidden();

        $this->loginAs($fixture['ownerUser']);
        $this->postJson($approval.'/evidence/requirement', ['reason' => 'Supporting statement needed.'])->assertNoContent();
        $approve = fn () => $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson($approval.'/decision', [
            'decision' => 'approved', 'reason' => 'Reviewed correction.',
        ]);
        $approve()->assertUnprocessable()->assertJsonValidationErrors('evidence');
        $this->assertDatabaseCount('approval_decisions', 0);
        $this->assertDatabaseHas('approval_requests', ['id' => $id, 'status' => 'pending']);

        $this->loginAs($fixture['employeeUser']);
        $supplement = $this->upload($id, UploadedFile::fake()->image('supplement.jpeg', 10, 10))->assertOk()->json('file.id');
        $this->getJson($url)->assertOk()->assertJsonPath('supplement.satisfied', true);
        $this->loginAs($fixture['ownerUser']);
        $decision = $approve()->assertOk()->json('request.decision_history.0.id');
        $this->assertDatabaseHas('correction_evidence_audit', ['action' => 'proof_used', 'evidence_id' => $supplement, 'approval_decision_id' => $decision]);
        $day = app(EffectiveAttendanceReader::class)->project((int) $fixture['tenant']->getKey(), (int) $fixture['employee']->getKey(), '2026-11-05');
        $snapshot = app(ApprovalWorkflowService::class)->finalize(
            $fixture['owner'], $fixture['ownerUser'], (int) $fixture['employee']->getKey(), '2026-11-05', $day['outcome'], 'Reviewed synthetic interval.',
        );
        $before = $snapshot->fresh()->getRawOriginal('projection_snapshot');
        $key = (string) Str::uuid();
        $this->upload($id, $png, $key, ['decision_id' => $decision + 100])->assertUnprocessable()->assertJsonValidationErrors('decision_id');
        $this->upload($id, $png, $key, ['decision_id' => $decision, 'finalization_id' => $snapshot->getKey()])
            ->assertOk()->assertJsonPath('file.decision_id', $decision)->assertJsonPath('file.finalization_id', $snapshot->getKey());
        $this->upload($id, $png, $key, ['decision_id' => $decision])->assertUnprocessable()->assertJsonValidationErrors('idempotency_key');
        $this->assertSame($before, $snapshot->fresh()->getRawOriginal('projection_snapshot'));
        $this->assertDatabaseCount('attendance_events', 0);
        $this->assertDatabaseCount('attendance_sessions', 0);
    }

    public function test_policy_changes_are_prospective_and_hold_blocks_expiration_until_release(): void
    {
        $fixture = $this->fixture();
        $id = (int) $fixture['request']->getKey();
        $retention = '/api/v1/management/correction-evidence/retention';
        $this->loginAs($fixture['employeeUser']);
        $this->putJson($retention, ['days' => 90])->assertForbidden();
        $this->loginAs($fixture['ownerUser']);
        $this->getJson($retention)->assertOk()->assertJsonPath('days', 365);
        $this->putJson($retention, ['days' => 89])->assertUnprocessable();
        $this->putJson($retention, ['days' => 1826])->assertUnprocessable();
        $this->putJson($retention, ['days' => 90])->assertOk()->assertJsonPath('days', 90);
        $file = UploadedFile::fake()->image('evidence.png', 10, 10);
        $first = $this->upload($id, $file)->assertOk()->assertJsonPath('file.retention_days', 90)->json('file.id');
        $this->putJson($retention, ['days' => 1825])->assertOk()->assertJsonPath('days', 1825);
        $second = $this->upload($id, $file)->assertOk()->assertJsonPath('file.retention_days', 1825)->json('file.id');
        $row = DB::table('correction_evidence')->find($first);
        $this->assertSame(90, $row->retention_days);
        [$secondOwner] = $this->membershipFor($fixture['owner'], TenantRole::Owner);
        $hold = '/api/v1/management/approvals/'.$id.'/evidence/'.$first.'/hold';
        $changeHold = fn (string $action) => $this->postJson($hold, ['action' => $action, 'reason' => 'Synthetic legal matter.']);
        $expiry = CarbonImmutable::parse($row->expires_at, 'UTC');
        Carbon::setTestNow($expiry->subHour());
        $this->assertSame(0, app(CorrectionEvidenceService::class)->expire(10, true)['eligible']);
        $changeHold('request')->assertNoContent();
        $changeHold('approve')->assertForbidden();
        Carbon::setTestNow($expiry);
        $this->assertSame(1, app(CorrectionEvidenceService::class)->expire(10, false)['protected']);
        $this->loginAs($secondOwner);
        $changeHold('approve')->assertNoContent();
        Carbon::setTestNow($expiry->addDays(3));
        $this->assertSame(1, app(CorrectionEvidenceService::class)->expire(10, false)['protected']);
        Storage::disk('local')->assertExists($row->storage_path);
        $this->getJson('/api/v1/correction-evidence/'.$id.'/'.$first)->assertOk();
        $changeHold('release')->assertNoContent();
        $this->getJson('/api/v1/correction-evidence/'.$id.'/'.$first)->assertNotFound();
        $this->assertSame(1, app(CorrectionEvidenceService::class)->expire(10, true)['eligible']);
        $this->artisan('attendance:correction-evidence-expire')->assertSuccessful();
        Storage::disk('local')->assertExists($row->storage_path);
        config(['attendance_evidence.correction_deletion_enabled' => true]);
        $this->artisan('attendance:correction-evidence-expire')->assertSuccessful();
        Storage::disk('local')->assertMissing($row->storage_path);
        $this->assertNotNull(DB::table('correction_evidence')->find($first)->deleted_at);
        $this->assertNull(DB::table('correction_evidence')->find($second)->deleted_at);
        $this->assertDatabaseHas('correction_evidence_audit', ['action' => 'expired', 'evidence_id' => $first]);

        $migration = require database_path('migrations/2026_11_05_000006_create_correction_evidence.php');
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Cannot discard recorded correction evidence');
        $migration->down();
    }

    public function test_storage_failure_rolls_back_metadata_and_retry_preserves_reversal_binding(): void
    {
        $fixture = $this->fixture();
        $id = (int) $fixture['request']->getKey();
        $this->loginAs($fixture['ownerUser']);
        $approval = '/api/v1/management/approvals/'.$id;
        $approved = $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson($approval.'/decision', [
            'decision' => 'approved', 'reason' => 'Reviewed without routine attachments.',
        ])->assertOk()->json('request.decision_history.0.id');
        $reversed = $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson($approval.'/reversal', [
            'decision_id' => $approved, 'reason' => 'Reviewed reversal without routine attachments.',
        ])->assertOk()->json('request.decision_history.1.id');

        $privateDisk = Storage::disk('local');
        $path = 'correction-evidence/'.$fixture['tenant']->getKey().'/'.$id;
        $privateDisk->put($path, 'A file blocks creation of the request directory.');
        $file = UploadedFile::fake()->image('reversal.png', 10, 10);
        $key = (string) Str::uuid();
        $this->upload($id, $file, $key, ['decision_id' => $reversed])->assertServiceUnavailable();
        $this->assertDatabaseCount('correction_evidence', 0);
        $this->assertDatabaseMissing('correction_evidence_audit', ['action' => 'uploaded']);
        $privateDisk->delete($path);
        $this->upload($id, $file, $key, ['decision_id' => $reversed])->assertOk()->assertJsonPath('file.decision_id', $reversed);

        $orphan = $path.'/'.Str::uuid().'.part';
        $privateDisk->put($orphan, 'Interrupted upload.');
        touch($privateDisk->path($orphan), now('UTC')->subDays(2)->timestamp);
        $this->assertSame(1, app(CorrectionEvidenceService::class)->expire(10, false)['orphans_deleted']);
        $privateDisk->assertMissing($orphan);
        $privateDisk->assertExists(DB::table('correction_evidence')->value('storage_path'));
    }

    private function fixture(): array
    {
        [$ownerUser, $tenant, $owner] = $this->tenantWithOwner('Correction evidence');
        [, $outlet] = $this->unitWithOutlet($owner);
        $employee = app(OrganizationService::class)->registerEmployee($owner, 'Evidence employee');
        app(EmployeeOutletAssignmentService::class)->assignPrimaryOutlet($owner, $employee, $outlet, now()->subDay());
        [$employeeUser, $membership] = $this->membershipFor($owner, TenantRole::Employee);
        app(TenantMembershipService::class)->linkEmployee($owner, $membership, $employee);
        $request = app(ApprovalWorkflowService::class)->submitEmployeeRequest($membership, $employeeUser, [
            'type' => 'attendance_correction', 'correction_target' => 'reconstruction',
            'work_date' => '2026-11-05', 'effective_outlet_id' => $outlet->getKey(),
            'effective_check_in_at' => '2026-11-05T01:00:00Z', 'effective_check_out_at' => '2026-11-05T09:00:00Z',
            'reason' => 'Missed physical attendance for a completed shift.',
        ], (string) Str::uuid());

        return compact('tenant', 'owner', 'ownerUser', 'employee', 'employeeUser', 'request');
    }

    private function loginAs(User $user): void
    {
        $this->withCredentials()->withHeaders(['Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/']);
        $cookie = $this->postJson('/api/v1/auth/login', ['identifier' => $user->email, 'password' => 'password'])
            ->assertOk()->getCookie(config('session.cookie'));
        $this->withCookie(config('session.cookie'), $cookie->getValue());
        Auth::forgetGuards();
    }

    private function upload(int $id, UploadedFile $file, ?string $key = null, array $bindings = []): TestResponse
    {
        return $this->post('/api/v1/correction-evidence/'.$id, [
            'file' => $file, 'key' => $key ?? (string) Str::uuid(), ...$bindings,
        ], ['Accept' => 'application/json']);
    }

    private function pdf(string $catalog = '', ?int $size = null): string
    {
        $build = function (int $padding) use ($catalog): string {
            $bytes = "%PDF-1.4\n%".str_repeat(' ', $padding)."\n";
            $offsets = [];
            $objects = [
                "<< /Type /Catalog /Pages 2 0 R $catalog >>",
                '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
                '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
            ];
            foreach ($objects as $index => $object) {
                $offsets[] = strlen($bytes);
                $bytes .= ($index + 1)." 0 obj\n".$object."\nendobj\n";
            }
            $xref = strlen($bytes);
            $bytes .= "xref\n0 4\n0000000000 65535 f \n";
            foreach ($offsets as $offset) {
                $bytes .= sprintf("%010d 00000 n \n", $offset);
            }

            return $bytes."trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n".sprintf('%010d', $xref)."\n%%EOF\n";
        };
        $base = $build(0);

        return $size === null ? $base : $build($size - strlen($base));
    }
}
