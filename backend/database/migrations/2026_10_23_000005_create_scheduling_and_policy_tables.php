<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenant_attendance_policy_versions', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->date('effective_from');
            $table->json('configuration');
            $table->unsignedBigInteger('actor_user_id')->nullable();
            $table->text('reason')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['tenant_id', 'effective_from'], 'tenant_policy_effective_unique');
            $table->unique(['tenant_id', 'id']);
            $table->foreign('tenant_id', 'tenant_policy_tenant_foreign')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('actor_user_id', 'tenant_policy_actor_foreign')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('outlet_attendance_policy_versions', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('outlet_id');
            $table->date('effective_from');
            $table->json('overrides');
            $table->unsignedBigInteger('actor_user_id')->nullable();
            $table->text('reason')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['tenant_id', 'outlet_id', 'effective_from'], 'outlet_policy_effective_unique');
            $table->unique(['tenant_id', 'id']);
            $table->index(['tenant_id', 'outlet_id', 'effective_from'], 'outlet_policy_lookup_index');
            $table->foreign(['tenant_id', 'outlet_id'], 'outlet_policy_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
            $table->foreign('actor_user_id', 'outlet_policy_actor_foreign')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('shift_templates', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->string('name', 120);
            $table->unsignedBigInteger('created_by_user_id');
            $table->timestamps();
            $table->unique(['tenant_id', 'id']);
            $table->unique(['tenant_id', 'name'], 'shift_templates_tenant_name_unique');
            $table->foreign('tenant_id', 'shift_templates_tenant_foreign')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('created_by_user_id', 'shift_templates_creator_foreign')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('shift_template_versions', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('shift_template_id');
            $table->unsignedInteger('revision');
            $table->time('start_time');
            $table->time('end_time');
            $table->boolean('crosses_midnight')->default(false);
            $table->date('effective_from');
            $table->unsignedBigInteger('actor_user_id');
            $table->text('reason')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['tenant_id', 'id']);
            $table->unique(['tenant_id', 'shift_template_id', 'revision'], 'shift_template_revision_unique');
            $table->unique(['tenant_id', 'shift_template_id', 'effective_from'], 'shift_template_effective_unique');
            $table->foreign(['tenant_id', 'shift_template_id'], 'shift_versions_template_foreign')
                ->references(['tenant_id', 'id'])->on('shift_templates')->restrictOnDelete();
            $table->foreign('actor_user_id', 'shift_versions_actor_foreign')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('weekly_schedule_rules', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('employee_id');
            $table->unsignedBigInteger('outlet_id');
            $table->unsignedTinyInteger('weekday');
            $table->unsignedBigInteger('shift_template_version_id')->nullable();
            $table->date('effective_from');
            $table->date('effective_until')->nullable();
            $table->unsignedBigInteger('created_by_user_id');
            $table->timestamps();
            $table->index(['tenant_id', 'employee_id', 'weekday', 'effective_from', 'effective_until'], 'weekly_rules_lookup_index');
            $table->index(['tenant_id', 'outlet_id', 'effective_from', 'effective_until'], 'weekly_rules_outlet_lookup_index');
            $table->foreign(['tenant_id', 'employee_id'], 'weekly_rules_employee_foreign')
                ->references(['tenant_id', 'id'])->on('employees')->restrictOnDelete();
            $table->foreign(['tenant_id', 'outlet_id'], 'weekly_rules_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
            $table->foreign(['tenant_id', 'shift_template_version_id'], 'weekly_rules_shift_version_foreign')
                ->references(['tenant_id', 'id'])->on('shift_template_versions')->restrictOnDelete();
            $table->foreign('created_by_user_id', 'weekly_rules_actor_foreign')->references('id')->on('users')->restrictOnDelete();
        });
        DB::statement('ALTER TABLE weekly_schedule_rules ADD CONSTRAINT weekly_rules_weekday_check CHECK (weekday between 1 and 7)');
        DB::statement('ALTER TABLE weekly_schedule_rules ADD CONSTRAINT weekly_rules_effective_range_check CHECK (effective_until is null or effective_until > effective_from)');

        Schema::create('schedule_exceptions', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('employee_id');
            $table->date('work_date');
            $table->unsignedInteger('revision');
            $table->enum('status', ['work', 'rest']);
            $table->unsignedBigInteger('outlet_id')->nullable();
            $table->unsignedBigInteger('shift_template_version_id')->nullable();
            $table->unsignedBigInteger('created_by_user_id');
            $table->text('reason');
            $table->timestamp('superseded_at')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['tenant_id', 'employee_id', 'work_date', 'revision'], 'schedule_exception_revision_unique');
            $table->index(['tenant_id', 'employee_id', 'work_date', 'superseded_at'], 'schedule_exception_lookup_index');
            $table->foreign(['tenant_id', 'employee_id'], 'schedule_exceptions_employee_foreign')
                ->references(['tenant_id', 'id'])->on('employees')->restrictOnDelete();
            $table->foreign(['tenant_id', 'outlet_id'], 'schedule_exceptions_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
            $table->foreign(['tenant_id', 'shift_template_version_id'], 'schedule_exceptions_shift_version_foreign')
                ->references(['tenant_id', 'id'])->on('shift_template_versions')->restrictOnDelete();
            $table->foreign('created_by_user_id', 'schedule_exceptions_actor_foreign')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('outlet_calendar_versions', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('outlet_id');
            $table->date('effective_from');
            $table->string('timezone', 64);
            $table->json('operating_weekdays');
            $table->unsignedBigInteger('actor_user_id')->nullable();
            $table->text('reason')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['tenant_id', 'outlet_id', 'effective_from'], 'outlet_calendar_effective_unique');
            $table->unique(['tenant_id', 'id']);
            $table->index(['tenant_id', 'outlet_id', 'effective_from'], 'outlet_calendar_lookup_index');
            $table->foreign(['tenant_id', 'outlet_id'], 'outlet_calendar_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
            $table->foreign('actor_user_id', 'outlet_calendar_actor_foreign')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('tenant_holiday_references', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->date('holiday_date');
            $table->string('name', 160);
            $table->string('region', 120)->nullable();
            $table->unsignedBigInteger('created_by_user_id');
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['tenant_id', 'id']);
            $table->unique(['tenant_id', 'holiday_date', 'name'], 'holiday_reference_unique');
            $table->index(['tenant_id', 'holiday_date'], 'holiday_reference_date_index');
            $table->foreign('tenant_id', 'holiday_reference_tenant_foreign')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('created_by_user_id', 'holiday_reference_actor_foreign')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('outlet_calendar_exceptions', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('outlet_id');
            $table->date('calendar_date');
            $table->unsignedInteger('revision');
            $table->enum('status', ['open', 'closed']);
            $table->unsignedBigInteger('holiday_reference_id')->nullable();
            $table->unsignedBigInteger('created_by_user_id');
            $table->text('reason');
            $table->timestamp('superseded_at')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['tenant_id', 'outlet_id', 'calendar_date', 'revision'], 'outlet_calendar_exception_revision_unique');
            $table->index(['tenant_id', 'outlet_id', 'calendar_date', 'superseded_at'], 'outlet_calendar_exception_lookup_index');
            $table->foreign(['tenant_id', 'outlet_id'], 'outlet_calendar_exception_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
            $table->foreign(['tenant_id', 'holiday_reference_id'], 'outlet_calendar_exception_holiday_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_holiday_references')->restrictOnDelete();
            $table->foreign('created_by_user_id', 'outlet_calendar_exception_actor_foreign')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('scheduling_change_events', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->string('resource_type', 60);
            $table->unsignedBigInteger('resource_id');
            $table->string('action', 32);
            $table->unsignedBigInteger('actor_user_id');
            $table->text('reason')->nullable();
            $table->json('previous_values')->nullable();
            $table->json('new_values')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->index(['tenant_id', 'resource_type', 'resource_id', 'created_at'], 'schedule_change_resource_index');
            $table->foreign('tenant_id', 'schedule_change_tenant_foreign')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('actor_user_id', 'schedule_change_actor_foreign')->references('id')->on('users')->restrictOnDelete();
        });

        $defaults = json_encode([
            'late_tolerance_minutes' => 5,
            'check_in_window' => ['early_minutes' => 60, 'late_minutes' => 60],
            'attendance_mode' => 'kiosk',
            'personal_location_validation' => ['required' => true, 'radius_meters' => 100],
            'retroactive_request_limit_days' => 7,
            'operational_review' => ['schedule_change_reason_required' => true, 'minimum_notice_hours' => 24],
        ], JSON_THROW_ON_ERROR);

        DB::table('tenants')->orderBy('id')->chunkById(250, function ($tenants) use ($defaults): void {
            foreach ($tenants as $tenant) {
                DB::table('tenant_attendance_policy_versions')->insertOrIgnore([
                    'tenant_id' => $tenant->id,
                    'effective_from' => substr((string) $tenant->created_at, 0, 10),
                    'configuration' => $defaults,
                ]);
            }
        });

        DB::table('outlets')->orderBy('id')->chunkById(250, function ($outlets): void {
            foreach ($outlets as $outlet) {
                DB::table('outlet_calendar_versions')->insertOrIgnore([
                    'tenant_id' => $outlet->tenant_id,
                    'outlet_id' => $outlet->id,
                    'effective_from' => substr((string) $outlet->created_at, 0, 10),
                    'timezone' => 'Asia/Jakarta',
                    'operating_weekdays' => json_encode([1, 2, 3, 4, 5, 6, 7], JSON_THROW_ON_ERROR),
                ]);
            }
        });
    }

    public function down(): void
    {
        if (app()->environment() !== 'testing' || config('database.connections.mysql.database') !== 'hadirinaja_test') {
            throw new RuntimeException('Scheduling migrations are forward-only outside the isolated hadirinaja_test database.');
        }

        Schema::dropIfExists('scheduling_change_events');
        Schema::dropIfExists('outlet_calendar_exceptions');
        Schema::dropIfExists('tenant_holiday_references');
        Schema::dropIfExists('outlet_calendar_versions');
        Schema::dropIfExists('schedule_exceptions');
        Schema::dropIfExists('weekly_schedule_rules');
        Schema::dropIfExists('shift_template_versions');
        Schema::dropIfExists('shift_templates');
        Schema::dropIfExists('outlet_attendance_policy_versions');
        Schema::dropIfExists('tenant_attendance_policy_versions');
    }
};
