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
            $table->dateTime('legal_hold_lease_consumed_at')->nullable()->after('deletion_retry_at');
        });

        Schema::create('attendance_evidence_legal_hold_requests', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('attendance_evidence_id');
            $table->unsignedBigInteger('attendance_event_id');
            $table->string('hold_reference', 128);
            $table->enum('request_type', ['placement', 'extension']);
            $table->enum('status', ['pending', 'approved', 'rejected', 'expired', 'released'])->default('pending');
            $table->text('justification');
            $table->unsignedTinyInteger('requested_duration_days');
            $table->dateTime('requested_expires_at');
            $table->dateTime('lease_expires_at');
            $table->boolean('preservation_lease_granted')->default(false);
            $table->unsignedBigInteger('requested_by_membership_id');
            $table->unsignedBigInteger('decided_by_membership_id')->nullable();
            $table->text('decision_reason')->nullable();
            $table->dateTime('created_at');
            $table->dateTime('decided_at')->nullable();
            $table->unique(['tenant_id', 'id'], 'evidence_hold_request_tenant_identity_unique');
            $table->index(['tenant_id', 'status', 'lease_expires_at'], 'evidence_hold_request_queue_index');
            $table->index(['tenant_id', 'attendance_evidence_id', 'status'], 'evidence_hold_request_evidence_index');
            $table->foreign(['tenant_id', 'attendance_evidence_id', 'attendance_event_id'], 'evidence_hold_request_evidence_foreign')
                ->references(['tenant_id', 'id', 'attendance_event_id'])->on('attendance_evidence')->restrictOnDelete();
            $table->foreign(['tenant_id', 'requested_by_membership_id'], 'evidence_hold_request_requester_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
            $table->foreign(['tenant_id', 'decided_by_membership_id'], 'evidence_hold_request_decider_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
        });

        Schema::create('attendance_evidence_legal_hold_workflow_events', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('attendance_evidence_id');
            $table->unsignedBigInteger('attendance_event_id');
            $table->unsignedBigInteger('request_id')->nullable();
            $table->string('hold_reference', 128);
            $table->enum('action', [
                'request_submitted', 'extension_requested', 'approved', 'single_owner_approved', 'legacy_bounded',
                'rejected', 'released', 'request_expired', 'hold_expired',
            ]);
            $table->unsignedBigInteger('actor_membership_id')->nullable();
            $table->text('reason')->nullable();
            $table->dateTime('lease_expires_at')->nullable();
            $table->dateTime('effective_expires_at')->nullable();
            $table->dateTime('occurred_at');
            $table->unique(['tenant_id', 'id'], 'evidence_hold_workflow_tenant_identity_unique');
            $table->index(['tenant_id', 'attendance_evidence_id', 'id'], 'evidence_hold_workflow_evidence_index');
            $table->foreign(['tenant_id', 'attendance_evidence_id', 'attendance_event_id'], 'evidence_hold_workflow_evidence_foreign')
                ->references(['tenant_id', 'id', 'attendance_event_id'])->on('attendance_evidence')->restrictOnDelete();
            $table->foreign(['tenant_id', 'request_id'], 'evidence_hold_workflow_request_foreign')
                ->references(['tenant_id', 'id'])->on('attendance_evidence_legal_hold_requests')->restrictOnDelete();
            $table->foreign(['tenant_id', 'actor_membership_id'], 'evidence_hold_workflow_actor_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
        });

        Schema::table('attendance_evidence_legal_hold_events', function (Blueprint $table): void {
            $table->dateTime('expires_at')->nullable()->after('action');
            $table->unsignedBigInteger('legal_hold_request_id')->nullable()->after('expires_at');
            $table->unsignedBigInteger('actor_membership_id')->nullable()->change();
            $table->foreign(['tenant_id', 'legal_hold_request_id'], 'attendance_evidence_hold_request_foreign')
                ->references(['tenant_id', 'id'])->on('attendance_evidence_legal_hold_requests')->restrictOnDelete();
        });
        DB::statement("ALTER TABLE attendance_evidence_legal_hold_events MODIFY action ENUM('placed', 'released', 'expired') NOT NULL");
    }

    public function down(): void
    {
        $connection = (string) config('database.default');
        $database = (string) config("database.connections.{$connection}.database");
        if (! app()->environment('testing') || $database !== 'hadirinaja_test') {
            throw new RuntimeException('Legal hold workflow migrations are forward-only outside the isolated hadirinaja_test database.');
        }

        Schema::table('attendance_evidence_legal_hold_events', function (Blueprint $table): void {
            $table->dropForeign('attendance_evidence_hold_request_foreign');
        });
        DB::table('attendance_evidence_legal_hold_events')->where('action', 'expired')->delete();
        DB::statement("ALTER TABLE attendance_evidence_legal_hold_events MODIFY action ENUM('placed', 'released') NOT NULL");
        Schema::table('attendance_evidence_legal_hold_events', function (Blueprint $table): void {
            $table->dropColumn(['expires_at', 'legal_hold_request_id']);
            $table->unsignedBigInteger('actor_membership_id')->nullable(false)->change();
        });
        Schema::dropIfExists('attendance_evidence_legal_hold_workflow_events');
        Schema::dropIfExists('attendance_evidence_legal_hold_requests');
        Schema::table('attendance_evidence', function (Blueprint $table): void {
            $table->dropColumn('legal_hold_lease_consumed_at');
        });
    }
};
