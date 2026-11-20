<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendance_evidence', function (Blueprint $table): void {
            $table->enum('lifecycle_state', ['available', 'deletion_pending', 'expired'])
                ->default('available')->after('validation_status');
            $table->dateTime('expires_at')->nullable()->after('lifecycle_state');
            $table->unsignedSmallInteger('deletion_attempts')->default(0)->after('expires_at');
            $table->dateTime('deletion_last_attempt_at')->nullable()->after('deletion_attempts');
            $table->dateTime('deletion_retry_at')->nullable()->after('deletion_last_attempt_at');
            $table->string('deletion_last_error_code', 64)->nullable()->after('deletion_retry_at');

            // Expired evidence keeps its event/session link as a tombstone, not file metadata.
            $table->string('storage_path', 255)->nullable()->change();
            $table->string('detected_mime_type', 80)->nullable()->change();
            $table->string('stored_mime_type', 80)->nullable()->change();
            $table->unsignedInteger('stored_size_bytes')->nullable()->change();
            $table->unsignedSmallInteger('image_width')->nullable()->change();
            $table->unsignedSmallInteger('image_height')->nullable()->change();
            $table->char('sha256', 64)->nullable()->change();

            $table->unique(['tenant_id', 'id', 'attendance_event_id'], 'attendance_evidence_tenant_event_identity_unique');
            $table->index(['lifecycle_state', 'expires_at'], 'attendance_evidence_expiry_index');
            $table->index(['lifecycle_state', 'deletion_retry_at'], 'attendance_evidence_retry_index');
        });

        $this->backfillExistingExpirations();

        Schema::create('attendance_evidence_audit_events', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->enum('actor_type', ['membership', 'system']);
            $table->unsignedBigInteger('actor_membership_id')->nullable();
            $table->unsignedBigInteger('attendance_event_id');
            $table->unsignedBigInteger('attendance_evidence_id');
            $table->enum('action', ['view', 'download', 'deletion']);
            $table->enum('outcome', ['success', 'denied', 'failure']);
            $table->timestamp('occurred_at');
            $table->unique(['tenant_id', 'id'], 'attendance_evidence_audit_tenant_identity_unique');
            $table->index(['tenant_id', 'occurred_at', 'id'], 'attendance_evidence_audit_time_index');
            $table->index(['tenant_id', 'attendance_evidence_id', 'occurred_at'], 'attendance_evidence_audit_evidence_index');
            $table->foreign(['tenant_id', 'actor_membership_id'], 'attendance_evidence_audit_actor_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
            $table->foreign(['tenant_id', 'attendance_event_id'], 'attendance_evidence_audit_event_foreign')
                ->references(['tenant_id', 'id'])->on('attendance_events')->restrictOnDelete();
            $table->foreign(['tenant_id', 'attendance_evidence_id', 'attendance_event_id'], 'attendance_evidence_audit_evidence_foreign')
                ->references(['tenant_id', 'id', 'attendance_event_id'])->on('attendance_evidence')->restrictOnDelete();
        });

        DB::statement("ALTER TABLE attendance_evidence_audit_events ADD CONSTRAINT attendance_evidence_audit_actor_check CHECK ((actor_type = 'membership' AND actor_membership_id IS NOT NULL) OR (actor_type = 'system' AND actor_membership_id IS NULL))");
    }

    public function backfillExistingExpirations(): void
    {
        DB::table('attendance_evidence as evidence')
            ->join('attendance_events as event', function ($join): void {
                $join->on('event.tenant_id', '=', 'evidence.tenant_id')
                    ->on('event.id', '=', 'evidence.attendance_event_id');
            })
            ->whereNull('evidence.expires_at')
            ->update(['expires_at' => DB::raw('DATE_ADD(event.recorded_at, INTERVAL 90 DAY)')]);
    }

    public function down(): void
    {
        $connection = (string) config('database.default');
        $database = (string) config("database.connections.{$connection}.database");

        if (! app()->environment('testing') || $database !== 'hadirinaja_test') {
            throw new RuntimeException('Attendance evidence lifecycle migrations are forward-only outside the isolated hadirinaja_test database.');
        }

        Schema::dropIfExists('attendance_evidence_audit_events');
        Schema::table('attendance_evidence', function (Blueprint $table): void {
            $table->dropIndex('attendance_evidence_expiry_index');
            $table->dropIndex('attendance_evidence_retry_index');
            $table->dropUnique('attendance_evidence_tenant_event_identity_unique');
            $table->dropColumn([
                'lifecycle_state', 'expires_at', 'deletion_attempts', 'deletion_last_attempt_at',
                'deletion_retry_at', 'deletion_last_error_code',
            ]);
            $table->string('storage_path', 255)->nullable(false)->change();
            $table->string('detected_mime_type', 80)->nullable(false)->change();
            $table->string('stored_mime_type', 80)->nullable(false)->change();
            $table->unsignedInteger('stored_size_bytes')->nullable(false)->change();
            $table->unsignedSmallInteger('image_width')->nullable(false)->change();
            $table->unsignedSmallInteger('image_height')->nullable(false)->change();
            $table->char('sha256', 64)->nullable(false)->change();
        });
    }
};
