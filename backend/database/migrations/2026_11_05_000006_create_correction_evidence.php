<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('approval_decisions', fn (Blueprint $table) => $table->unique(
            ['tenant_id', 'approval_request_id', 'id'], 'approval_decision_request_identity',
        ));
        Schema::table('attendance_finalizations', fn (Blueprint $table) => $table->unique(
            ['tenant_id', 'employee_id', 'id'], 'attendance_finalization_employee_identity',
        ));
        Schema::create('correction_evidence_retention', function (Blueprint $table): void {
            $table->foreignId('tenant_id')->primary()->constrained()->restrictOnDelete();
            $table->unsignedSmallInteger('days');
        });
        Schema::create('correction_evidence', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('approval_request_id');
            $table->unsignedBigInteger('employee_id');
            $table->unsignedBigInteger('approval_decision_id')->nullable();
            $table->unsignedBigInteger('attendance_finalization_id')->nullable();
            $table->unsignedBigInteger('uploader_membership_id');
            $table->unsignedTinyInteger('slot');
            $table->uuid('upload_key');
            $table->string('storage_path')->unique();
            $table->enum('mime_type', ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
            $table->unsignedInteger('size_bytes');
            $table->char('sha256', 64);
            $table->unsignedSmallInteger('retention_days');
            $table->dateTime('uploaded_at');
            $table->dateTime('expires_at');
            $table->dateTime('deletion_started_at')->nullable();
            $table->dateTime('deleted_at')->nullable();
            $table->unique(['tenant_id', 'approval_request_id', 'id'], 'correction_evidence_request_identity');
            $table->unique(['tenant_id', 'approval_request_id', 'slot'], 'correction_evidence_slot');
            $table->unique(['tenant_id', 'approval_request_id', 'uploader_membership_id', 'upload_key'], 'correction_evidence_upload_key');
            $table->index(['deleted_at', 'expires_at']);
            $table->foreign(['tenant_id', 'approval_request_id', 'employee_id'], 'correction_evidence_request_fk')
                ->references(['tenant_id', 'id', 'employee_id'])->on('approval_requests')->restrictOnDelete();
            $table->foreign(['tenant_id', 'approval_request_id', 'approval_decision_id'], 'correction_evidence_decision_fk')
                ->references(['tenant_id', 'approval_request_id', 'id'])->on('approval_decisions')->restrictOnDelete();
            $table->foreign(['tenant_id', 'employee_id', 'attendance_finalization_id'], 'correction_evidence_finalization_fk')
                ->references(['tenant_id', 'employee_id', 'id'])->on('attendance_finalizations')->restrictOnDelete();
            $table->foreign(['tenant_id', 'uploader_membership_id'], 'correction_evidence_uploader_fk')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
        });
        Schema::create('correction_evidence_audit', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->restrictOnDelete();
            $table->unsignedBigInteger('approval_request_id')->nullable();
            $table->unsignedBigInteger('evidence_id')->nullable();
            $table->unsignedBigInteger('approval_decision_id')->nullable();
            $table->unsignedBigInteger('actor_membership_id')->nullable();
            $table->string('action', 32);
            $table->text('reason')->nullable();
            $table->json('details')->nullable();
            $table->dateTime('acted_at');
            $table->index(['tenant_id', 'approval_request_id', 'action', 'id'], 'correction_evidence_request_audit');
            $table->index(['tenant_id', 'evidence_id', 'action', 'id'], 'correction_evidence_file_audit');
            $table->foreign(['tenant_id', 'approval_request_id'], 'correction_evidence_audit_request_fk')
                ->references(['tenant_id', 'id'])->on('approval_requests')->restrictOnDelete();
            $table->foreign(['tenant_id', 'approval_request_id', 'evidence_id'], 'correction_evidence_audit_file_fk')
                ->references(['tenant_id', 'approval_request_id', 'id'])->on('correction_evidence')->restrictOnDelete();
            $table->foreign(['tenant_id', 'approval_request_id', 'approval_decision_id'], 'correction_evidence_audit_decision_fk')
                ->references(['tenant_id', 'approval_request_id', 'id'])->on('approval_decisions')->restrictOnDelete();
            $table->foreign(['tenant_id', 'actor_membership_id'], 'correction_evidence_audit_actor_fk')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
        });
        DB::statement('ALTER TABLE correction_evidence ADD CONSTRAINT correction_evidence_limits CHECK (slot BETWEEN 1 AND 3 AND size_bytes BETWEEN 1 AND 5242880 AND retention_days BETWEEN 90 AND 1825 AND (deleted_at IS NULL OR deletion_started_at IS NOT NULL))');
        DB::statement('ALTER TABLE correction_evidence_audit ADD CONSTRAINT correction_evidence_audit_binding CHECK (approval_request_id IS NOT NULL OR (evidence_id IS NULL AND approval_decision_id IS NULL))');
        DB::statement('ALTER TABLE correction_evidence_retention ADD CONSTRAINT correction_evidence_retention_limits CHECK (days BETWEEN 90 AND 1825)');
    }

    public function down(): void
    {
        if (DB::table('correction_evidence_audit')->exists() || DB::table('correction_evidence')->exists()
            || DB::table('correction_evidence_retention')->exists()) {
            throw new RuntimeException('Cannot discard recorded correction evidence, policy, or audit history.');
        }
        Schema::drop('correction_evidence_audit');
        Schema::drop('correction_evidence');
        Schema::drop('correction_evidence_retention');
        Schema::table('attendance_finalizations', fn (Blueprint $table) => $table->dropUnique('attendance_finalization_employee_identity'));
        Schema::table('approval_decisions', fn (Blueprint $table) => $table->dropUnique('approval_decision_request_identity'));
    }
};
