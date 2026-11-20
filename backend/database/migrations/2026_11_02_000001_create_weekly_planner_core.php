<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('outlets', fn (Blueprint $table) => $table->date('weekly_planner_start_on')->nullable());
        Schema::create('schedule_weeks', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('outlet_id');
            $table->date('week_start');
            $table->unsignedInteger('lock_version')->default(0);
            $table->unsignedBigInteger('draft_revision_id')->nullable();
            $table->unsignedBigInteger('published_revision_id')->nullable();
            $table->unique(['tenant_id', 'outlet_id', 'week_start'], 'planner_week_unique');
            $table->unique(['tenant_id', 'id'], 'planner_week_tenant_unique');
            $table->foreign(['tenant_id', 'outlet_id'], 'planner_week_outlet_fk')->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
        });
        Schema::create('schedule_revisions', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('week_id');
            $table->unsignedInteger('revision');
            $table->unsignedBigInteger('base_published_revision_id')->nullable();
            $table->unsignedBigInteger('actor_membership_id');
            $table->timestamp('published_at')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['tenant_id', 'week_id', 'revision'], 'planner_revision_number_unique');
            $table->unique(['tenant_id', 'week_id', 'id'], 'planner_revision_week_unique');
            $table->unique(['tenant_id', 'id'], 'planner_revision_tenant_unique');
            $table->foreign(['tenant_id', 'week_id'], 'planner_revision_week_fk')->references(['tenant_id', 'id'])->on('schedule_weeks')->restrictOnDelete();
            $table->foreign(['tenant_id', 'actor_membership_id'], 'planner_revision_actor_fk')->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
        });
        Schema::table('schedule_weeks', function (Blueprint $table): void {
            foreach (['draft', 'published'] as $kind) {
                $table->foreign(['tenant_id', 'id', $kind.'_revision_id'], 'planner_week_'.$kind.'_fk')
                    ->references(['tenant_id', 'week_id', 'id'])->on('schedule_revisions')->restrictOnDelete();
            }
        });
        Schema::create('schedule_entries', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('revision_id');
            $table->unsignedBigInteger('employee_id');
            $table->date('work_date');
            $table->enum('status', ['work', 'rest', 'unscheduled']);
            $table->unsignedBigInteger('shift_template_version_id')->nullable();
            $table->json('schedule_snapshot')->nullable();
            $table->unique(['tenant_id', 'revision_id', 'employee_id', 'work_date'], 'planner_entry_unique');
            $table->foreign(['tenant_id', 'revision_id'], 'planner_entry_revision_fk')->references(['tenant_id', 'id'])->on('schedule_revisions')->restrictOnDelete();
            $table->foreign(['tenant_id', 'employee_id'], 'planner_entry_employee_fk')->references(['tenant_id', 'id'])->on('employees')->restrictOnDelete();
            $table->foreign(['tenant_id', 'shift_template_version_id'], 'planner_entry_shift_fk')->references(['tenant_id', 'id'])->on('shift_template_versions')->restrictOnDelete();
        });
        DB::statement("ALTER TABLE schedule_entries ADD CONSTRAINT planner_entry_shift_check CHECK ((status = 'work' AND shift_template_version_id IS NOT NULL) OR (status <> 'work' AND shift_template_version_id IS NULL))");
        Schema::create('scheduling_operations', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('actor_membership_id');
            $table->string('idempotency_key', 100);
            $table->char('request_hash', 64);
            $table->json('response');
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['tenant_id', 'actor_membership_id', 'idempotency_key'], 'planner_operation_unique');
            $table->foreign(['tenant_id', 'actor_membership_id'], 'planner_operation_actor_fk')->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        if (! app()->environment('testing') || DB::connection()->getDatabaseName() !== 'hadirinaja_test') {
            throw new RuntimeException('Planner rollback is restricted to the disposable test database.');
        }
        Schema::dropIfExists('scheduling_operations');
        Schema::dropIfExists('schedule_entries');
        Schema::table('schedule_weeks', function (Blueprint $table): void {
            $table->dropForeign('planner_week_draft_fk');
            $table->dropForeign('planner_week_published_fk');
        });
        Schema::dropIfExists('schedule_revisions');
        Schema::dropIfExists('schedule_weeks');
        Schema::table('outlets', fn (Blueprint $table) => $table->dropColumn('weekly_planner_start_on'));
    }
};
