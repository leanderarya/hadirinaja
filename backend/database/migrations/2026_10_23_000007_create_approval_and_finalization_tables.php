<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\QueryException;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        try {
            DB::statement('ALTER TABLE attendance_sessions DROP CHECK attendance_session_state_check');
        } catch (QueryException) {
            DB::statement('ALTER TABLE attendance_sessions DROP CONSTRAINT attendance_session_state_check');
        }

        DB::statement("ALTER TABLE attendance_sessions MODIFY status ENUM('active', 'closed', 'administratively_resolved') NOT NULL");
        DB::statement("ALTER TABLE attendance_sessions ADD CONSTRAINT attendance_session_state_check CHECK ((status = 'active' AND check_out_at IS NULL) OR (status = 'closed' AND check_out_at IS NOT NULL) OR (status = 'administratively_resolved' AND check_out_at IS NULL))");

        Schema::create('approval_requests', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('employee_id');
            $table->unsignedBigInteger('outlet_id')->nullable();
            $table->unsignedBigInteger('requester_user_id')->nullable();
            $table->unsignedBigInteger('requester_membership_id')->nullable();
            $table->enum('request_type', ['leave', 'overtime', 'attendance_correction', 'attendance_review']);
            $table->enum('status', ['pending', 'approved', 'rejected', 'cancelled'])->default('pending');
            $table->date('work_date')->nullable();
            $table->date('starts_on')->nullable();
            $table->date('ends_on')->nullable();
            $table->text('reason')->nullable();
            $table->json('details');
            $table->char('submission_key', 36)->nullable();
            $table->char('review_key', 64)->nullable();
            $table->timestamps();
            $table->unique(['tenant_id', 'id']);
            $table->unique(['tenant_id', 'id', 'employee_id'], 'approval_request_employee_identity_unique');
            $table->unique(['tenant_id', 'requester_user_id', 'submission_key'], 'approval_request_submission_unique');
            $table->unique(['tenant_id', 'review_key'], 'approval_request_review_key_unique');
            $table->index(['tenant_id', 'status', 'request_type', 'work_date'], 'approval_queue_type_date_index');
            $table->index(['tenant_id', 'employee_id', 'created_at'], 'approval_employee_history_index');
            $table->foreign(['tenant_id', 'employee_id'], 'approval_request_employee_foreign')
                ->references(['tenant_id', 'id'])->on('employees')->restrictOnDelete();
            $table->foreign(['tenant_id', 'outlet_id'], 'approval_request_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
            $table->foreign('requester_user_id', 'approval_request_requester_user_foreign')
                ->references('id')->on('users')->restrictOnDelete();
            $table->foreign(['tenant_id', 'requester_membership_id'], 'approval_request_requester_membership_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
        });
        DB::statement('ALTER TABLE approval_requests ADD CONSTRAINT approval_request_date_range_check CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on)');
        DB::statement('ALTER TABLE approval_requests ADD CONSTRAINT approval_request_requester_identity_check CHECK ((requester_user_id IS NULL AND requester_membership_id IS NULL) OR (requester_user_id IS NOT NULL AND requester_membership_id IS NOT NULL))');

        Schema::create('approval_decisions', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('approval_request_id');
            $table->unsignedBigInteger('employee_id');
            $table->unsignedBigInteger('actor_user_id');
            $table->unsignedBigInteger('actor_membership_id');
            $table->enum('action', ['approved', 'rejected', 'cancelled', 'routine_applied', 'review_accepted', 'review_rejected', 'finalized']);
            $table->text('reason')->nullable();
            $table->json('original_values')->nullable();
            $table->json('proposed_values')->nullable();
            $table->json('effective_values')->nullable();
            $table->char('idempotency_key', 36)->nullable();
            $table->timestamp('acted_at');
            $table->unique(['tenant_id', 'actor_user_id', 'idempotency_key'], 'approval_decision_idempotency_unique');
            $table->index(['tenant_id', 'approval_request_id', 'acted_at'], 'approval_decision_history_index');
            $table->foreign(['tenant_id', 'approval_request_id', 'employee_id'], 'approval_decision_request_employee_foreign')
                ->references(['tenant_id', 'id', 'employee_id'])->on('approval_requests')->restrictOnDelete();
            $table->foreign('actor_user_id', 'approval_decision_actor_user_foreign')
                ->references('id')->on('users')->restrictOnDelete();
            $table->foreign(['tenant_id', 'actor_membership_id'], 'approval_decision_actor_membership_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
        });

        Schema::create('attendance_corrections', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('employee_id');
            $table->unsignedBigInteger('attendance_session_id');
            $table->unsignedBigInteger('approval_request_id');
            $table->enum('classification', ['routine', 'sensitive']);
            $table->json('original_values');
            $table->json('proposed_values');
            $table->unsignedBigInteger('created_by_user_id');
            $table->timestamp('created_at');
            $table->unique(['tenant_id', 'approval_request_id'], 'attendance_correction_request_unique');
            $table->index(['tenant_id', 'attendance_session_id'], 'attendance_correction_session_index');
            $table->foreign(['tenant_id', 'approval_request_id', 'employee_id'], 'attendance_correction_request_employee_foreign')
                ->references(['tenant_id', 'id', 'employee_id'])->on('approval_requests')->restrictOnDelete();
            $table->foreign(['tenant_id', 'employee_id', 'attendance_session_id'], 'attendance_correction_session_foreign')
                ->references(['tenant_id', 'employee_id', 'id'])->on('attendance_sessions')->restrictOnDelete();
            $table->foreign('created_by_user_id', 'attendance_correction_creator_foreign')
                ->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('attendance_finalizations', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('employee_id');
            $table->unsignedBigInteger('outlet_id')->nullable();
            $table->date('work_date');
            $table->unsignedInteger('revision');
            $table->enum('outcome', ['present', 'leave', 'sick', 'permission', 'absence', 'exceptional_attendance']);
            $table->text('reason');
            $table->json('projection_snapshot');
            $table->unsignedBigInteger('actor_user_id');
            $table->timestamp('finalized_at');
            $table->unique(['tenant_id', 'employee_id', 'work_date', 'revision'], 'attendance_finalization_revision_unique');
            $table->index(['tenant_id', 'outlet_id', 'work_date'], 'attendance_finalization_outlet_date_index');
            $table->foreign(['tenant_id', 'employee_id'], 'attendance_finalization_employee_foreign')
                ->references(['tenant_id', 'id'])->on('employees')->restrictOnDelete();
            $table->foreign(['tenant_id', 'outlet_id'], 'attendance_finalization_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
            $table->foreign('actor_user_id', 'attendance_finalization_actor_foreign')
                ->references('id')->on('users')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        $connection = (string) config('database.default');
        $database = (string) config("database.connections.{$connection}.database");

        if (! app()->environment('testing') || $database !== 'hadirinaja_test') {
            throw new RuntimeException('Approval and finalization migrations are forward-only outside the isolated hadirinaja_test database.');
        }

        Schema::dropIfExists('attendance_finalizations');
        Schema::dropIfExists('attendance_corrections');
        Schema::dropIfExists('approval_decisions');
        Schema::dropIfExists('approval_requests');
        $checkConstraint = DB::connection()->isMaria() ? 'CONSTRAINT' : 'CHECK';
        DB::statement("ALTER TABLE attendance_sessions DROP {$checkConstraint} attendance_session_state_check");
        DB::table('attendance_sessions')->where('status', 'administratively_resolved')->update([
            'status' => 'closed',
            'check_out_at' => DB::raw('check_in_at'),
        ]);
        DB::statement("ALTER TABLE attendance_sessions MODIFY status ENUM('active', 'closed') NOT NULL");
        DB::statement("ALTER TABLE attendance_sessions ADD CONSTRAINT attendance_session_state_check CHECK ((status = 'active' AND check_out_at IS NULL) OR (status = 'closed' AND check_out_at IS NOT NULL))");
    }
};
