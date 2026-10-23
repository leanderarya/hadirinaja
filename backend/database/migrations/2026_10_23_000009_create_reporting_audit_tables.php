<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendance_events', function (Blueprint $table): void {
            $table->index(['tenant_id', 'outlet_id', 'recorded_at', 'id'], 'attendance_event_outlet_time_index');
        });
        Schema::table('approval_requests', function (Blueprint $table): void {
            $table->index(['tenant_id', 'outlet_id', 'work_date', 'status'], 'approval_request_outlet_date_index');
        });
        Schema::table('approval_decisions', function (Blueprint $table): void {
            $table->index(['tenant_id', 'acted_at', 'id'], 'approval_decision_tenant_time_index');
        });
        Schema::table('scheduling_change_events', function (Blueprint $table): void {
            $table->index(['tenant_id', 'created_at', 'id'], 'schedule_change_tenant_time_index');
        });

        Schema::create('report_export_events', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('actor_user_id');
            $table->unsignedBigInteger('actor_membership_id');
            $table->string('report_type', 48);
            $table->json('filters');
            $table->unsignedInteger('row_count');
            $table->timestamp('generated_at');
            $table->unique(['tenant_id', 'id'], 'report_export_tenant_identity_unique');
            $table->index(['tenant_id', 'generated_at', 'id'], 'report_export_tenant_time_index');
            $table->foreign(['tenant_id', 'actor_membership_id'], 'report_export_actor_membership_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
            $table->foreign('actor_user_id', 'report_export_actor_user_foreign')
                ->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('report_export_event_outlets', function (Blueprint $table): void {
            $table->innoDb();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('report_export_event_id');
            $table->unsignedBigInteger('outlet_id');
            $table->primary(['tenant_id', 'report_export_event_id', 'outlet_id'], 'report_export_outlet_primary');
            $table->index(['tenant_id', 'outlet_id', 'report_export_event_id'], 'report_export_outlet_scope_index');
            $table->foreign(['tenant_id', 'report_export_event_id'], 'report_export_event_scope_foreign')
                ->references(['tenant_id', 'id'])->on('report_export_events')->restrictOnDelete();
            $table->foreign(['tenant_id', 'outlet_id'], 'report_export_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        $connection = (string) config('database.default');
        $database = (string) config("database.connections.{$connection}.database");
        if (! app()->environment('testing') || $database !== 'hadirinaja_test') {
            throw new RuntimeException('Reporting audit migration is forward-only outside the isolated hadirinaja_test database.');
        }

        Schema::dropIfExists('report_export_event_outlets');
        Schema::dropIfExists('report_export_events');
        Schema::table('scheduling_change_events', fn (Blueprint $table) => $table->dropIndex('schedule_change_tenant_time_index'));
        Schema::table('approval_decisions', fn (Blueprint $table) => $table->dropIndex('approval_decision_tenant_time_index'));
        Schema::table('approval_requests', function (Blueprint $table): void {
            // MySQL uses this composite index to support the outlet foreign key.
            // Replace it with an equivalent FK-supporting index when rolling back
            // inside the isolated migration test database.
            $table->dropForeign('approval_request_outlet_foreign');
            $table->dropIndex('approval_request_outlet_date_index');
            $table->foreign(['tenant_id', 'outlet_id'], 'approval_request_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
        });
        Schema::table('attendance_events', function (Blueprint $table): void {
            // This composite index also supports the tenant-scoped outlet FK.
            $table->dropForeign('attendance_event_outlet_foreign');
            $table->dropIndex('attendance_event_outlet_time_index');
            $table->foreign(['tenant_id', 'outlet_id'], 'attendance_event_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
        });
    }
};
