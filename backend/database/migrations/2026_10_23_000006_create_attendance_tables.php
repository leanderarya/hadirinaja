<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_user_links', function (Blueprint $table): void {
            $table->unique(['tenant_id', 'tenant_membership_id', 'employee_id'], 'employee_user_link_identity_unique');
        });
        Schema::table('kiosk_devices', function (Blueprint $table): void {
            $table->unique(['tenant_id', 'id', 'outlet_id'], 'kiosk_device_outlet_identity_unique');
        });

        Schema::create('attendance_idempotency_records', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('employee_id');
            $table->unsignedBigInteger('tenant_membership_id')->nullable();
            $table->unsignedBigInteger('kiosk_device_id')->nullable();
            $table->enum('operation', ['check_in', 'check_out']);
            $table->char('idempotency_key', 36);
            $table->char('request_hash', 64);
            $table->enum('status', ['pending', 'completed', 'rejected'])->default('pending');
            $table->unsignedSmallInteger('response_status')->nullable();
            $table->json('response_body')->nullable();
            $table->timestamps();
            $table->unique(['tenant_id', 'id']);
            $table->unique(['tenant_id', 'id', 'employee_id', 'tenant_membership_id', 'kiosk_device_id'], 'attendance_idem_actor_identity_unique');
            $table->unique(
                ['tenant_id', 'tenant_membership_id', 'employee_id', 'operation', 'idempotency_key'],
                'attendance_idem_personal_unique',
            );
            $table->unique(
                ['tenant_id', 'kiosk_device_id', 'employee_id', 'operation', 'idempotency_key'],
                'attendance_idem_kiosk_unique',
            );
            $table->index(['tenant_id', 'employee_id', 'created_at'], 'attendance_idem_employee_index');
            $table->foreign(['tenant_id', 'employee_id'], 'attendance_idem_employee_foreign')
                ->references(['tenant_id', 'id'])->on('employees')->restrictOnDelete();
            $table->foreign(['tenant_id', 'tenant_membership_id'], 'attendance_idem_membership_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
            $table->foreign(['tenant_id', 'tenant_membership_id', 'employee_id'], 'attendance_idem_employee_link_foreign')
                ->references(['tenant_id', 'tenant_membership_id', 'employee_id'])->on('employee_user_links')->restrictOnDelete();
            $table->foreign(['tenant_id', 'kiosk_device_id'], 'attendance_idem_kiosk_foreign')
                ->references(['tenant_id', 'id'])->on('kiosk_devices')->restrictOnDelete();
        });
        DB::statement('ALTER TABLE attendance_idempotency_records ADD CONSTRAINT attendance_idempotency_actor_check CHECK ((tenant_membership_id IS NULL) <> (kiosk_device_id IS NULL))');

        Schema::create('attendance_sessions', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('employee_id');
            $table->unsignedBigInteger('outlet_id');
            $table->date('work_date');
            $table->enum('status', ['active', 'closed']);
            $table->dateTime('check_in_at');
            $table->dateTime('check_out_at')->nullable();
            $table->json('schedule_snapshot');
            $table->json('policy_snapshot');
            $table->json('assignment_snapshot');
            $table->json('review_indicators');
            $table->timestamps();
            $table->unique(['tenant_id', 'id']);
            $table->unique(['tenant_id', 'employee_id', 'id'], 'attendance_sessions_tenant_employee_id_unique');
            $table->unique(['tenant_id', 'employee_id', 'id', 'outlet_id'], 'attendance_session_employee_outlet_unique');
            $table->index(['tenant_id', 'employee_id', 'check_in_at'], 'attendance_sessions_employee_time_index');
            $table->index(['tenant_id', 'outlet_id', 'work_date', 'status'], 'attendance_sessions_outlet_date_index');
            $table->foreign(['tenant_id', 'employee_id'], 'attendance_sessions_employee_foreign')
                ->references(['tenant_id', 'id'])->on('employees')->restrictOnDelete();
            $table->foreign(['tenant_id', 'outlet_id'], 'attendance_sessions_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
        });
        DB::statement("ALTER TABLE attendance_sessions ADD CONSTRAINT attendance_session_state_check CHECK ((status = 'active' AND check_out_at IS NULL) OR (status = 'closed' AND check_out_at IS NOT NULL))");
        DB::statement('ALTER TABLE attendance_sessions ADD CONSTRAINT attendance_session_interval_check CHECK (check_out_at IS NULL OR check_out_at >= check_in_at)');

        Schema::create('attendance_active_session_owners', function (Blueprint $table): void {
            $table->innoDb();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('employee_id');
            $table->unsignedBigInteger('attendance_session_id');
            $table->timestamp('created_at')->useCurrent();
            $table->primary(['tenant_id', 'employee_id'], 'attendance_active_owner_primary');
            $table->unique(['tenant_id', 'attendance_session_id'], 'attendance_active_session_unique');
            $table->foreign(['tenant_id', 'employee_id'], 'attendance_active_employee_foreign')
                ->references(['tenant_id', 'id'])->on('employees')->restrictOnDelete();
            $table->foreign(['tenant_id', 'employee_id', 'attendance_session_id'], 'attendance_active_session_foreign')
                ->references(['tenant_id', 'employee_id', 'id'])->on('attendance_sessions')->restrictOnDelete();
        });

        Schema::create('attendance_events', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('employee_id');
            $table->unsignedBigInteger('attendance_session_id');
            $table->unsignedBigInteger('idempotency_record_id');
            $table->unsignedBigInteger('outlet_id');
            $table->unsignedBigInteger('tenant_membership_id')->nullable();
            $table->unsignedBigInteger('kiosk_device_id')->nullable();
            $table->enum('event_type', ['check_in', 'check_out']);
            $table->enum('origin', ['personal', 'kiosk']);
            $table->dateTime('recorded_at');
            $table->string('location_capture_status', 24)->default('not_requested');
            $table->string('location_verdict', 32)->nullable();
            $table->decimal('location_latitude', 10, 7)->nullable();
            $table->decimal('location_longitude', 10, 7)->nullable();
            $table->decimal('location_accuracy_meters', 8, 2)->nullable();
            $table->json('context_snapshot');
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['tenant_id', 'id']);
            $table->unique(['tenant_id', 'id', 'attendance_session_id'], 'attendance_event_session_identity_unique');
            $table->unique(['tenant_id', 'attendance_session_id', 'event_type'], 'attendance_event_session_type_unique');
            $table->unique(['tenant_id', 'idempotency_record_id'], 'attendance_event_idempotency_unique');
            $table->index(['tenant_id', 'employee_id', 'recorded_at'], 'attendance_events_employee_time_index');
            $table->foreign(['tenant_id', 'employee_id', 'attendance_session_id', 'outlet_id'], 'attendance_event_session_employee_outlet_foreign')
                ->references(['tenant_id', 'employee_id', 'id', 'outlet_id'])->on('attendance_sessions')->restrictOnDelete();
            $table->foreign(['tenant_id', 'idempotency_record_id', 'employee_id', 'tenant_membership_id', 'kiosk_device_id'], 'attendance_event_idempotency_actor_foreign')
                ->references(['tenant_id', 'id', 'employee_id', 'tenant_membership_id', 'kiosk_device_id'])->on('attendance_idempotency_records')->restrictOnDelete();
            $table->foreign(['tenant_id', 'outlet_id'], 'attendance_event_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
            $table->foreign(['tenant_id', 'tenant_membership_id'], 'attendance_event_membership_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
            $table->foreign(['tenant_id', 'tenant_membership_id', 'employee_id'], 'attendance_event_employee_link_foreign')
                ->references(['tenant_id', 'tenant_membership_id', 'employee_id'])->on('employee_user_links')->restrictOnDelete();
            $table->foreign(['tenant_id', 'kiosk_device_id'], 'attendance_event_kiosk_foreign')
                ->references(['tenant_id', 'id'])->on('kiosk_devices')->restrictOnDelete();
            $table->foreign(['tenant_id', 'kiosk_device_id', 'outlet_id'], 'attendance_event_kiosk_outlet_foreign')
                ->references(['tenant_id', 'id', 'outlet_id'])->on('kiosk_devices')->restrictOnDelete();
        });
        DB::statement("ALTER TABLE attendance_events ADD CONSTRAINT attendance_events_actor_check CHECK ((origin = 'personal' AND tenant_membership_id IS NOT NULL AND kiosk_device_id IS NULL) OR (origin = 'kiosk' AND tenant_membership_id IS NULL AND kiosk_device_id IS NOT NULL))");

        Schema::create('attendance_evidence', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('attendance_session_id');
            $table->unsignedBigInteger('attendance_event_id');
            $table->string('evidence_type', 32);
            $table->string('storage_path', 255)->unique();
            $table->string('detected_mime_type', 80);
            $table->string('stored_mime_type', 80);
            $table->unsignedInteger('stored_size_bytes');
            $table->unsignedSmallInteger('image_width');
            $table->unsignedSmallInteger('image_height');
            $table->char('sha256', 64);
            $table->string('validation_status', 24);
            $table->timestamp('received_at');
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['tenant_id', 'attendance_event_id'], 'attendance_evidence_event_unique');
            $table->unique(['tenant_id', 'attendance_session_id', 'sha256'], 'attendance_evidence_session_hash_unique');
            $table->foreign(['tenant_id', 'attendance_session_id'], 'attendance_evidence_session_foreign')
                ->references(['tenant_id', 'id'])->on('attendance_sessions')->restrictOnDelete();
            $table->foreign(['tenant_id', 'attendance_event_id', 'attendance_session_id'], 'attendance_evidence_event_session_foreign')
                ->references(['tenant_id', 'id', 'attendance_session_id'])->on('attendance_events')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        $connection = (string) config('database.default');
        $database = (string) config("database.connections.{$connection}.database");

        if (! app()->environment('testing') || $database !== 'hadirinaja_test') {
            throw new RuntimeException('Attendance migrations are forward-only outside the isolated hadirinaja_test database.');
        }

        Schema::dropIfExists('attendance_evidence');
        Schema::dropIfExists('attendance_events');
        Schema::dropIfExists('attendance_active_session_owners');
        Schema::dropIfExists('attendance_sessions');
        Schema::dropIfExists('attendance_idempotency_records');
        Schema::table('kiosk_devices', function (Blueprint $table): void {
            $table->dropUnique('kiosk_device_outlet_identity_unique');
        });
        Schema::table('employee_user_links', function (Blueprint $table): void {
            $table->dropUnique('employee_user_link_identity_unique');
        });
    }
};
