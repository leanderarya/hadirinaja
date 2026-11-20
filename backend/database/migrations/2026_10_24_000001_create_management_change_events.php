<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('management_change_events', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('actor_user_id');
            $table->unsignedBigInteger('actor_membership_id');
            $table->unsignedBigInteger('employee_id')->nullable();
            $table->unsignedBigInteger('outlet_id')->nullable();
            $table->string('subject_type', 32);
            $table->unsignedBigInteger('subject_id');
            $table->string('action', 48);
            $table->json('changed_fields');
            $table->timestamp('occurred_at');
            $table->unique(['tenant_id', 'id'], 'management_change_tenant_identity_unique');
            $table->index(['tenant_id', 'occurred_at', 'id'], 'management_change_tenant_time_index');
            $table->index(['tenant_id', 'outlet_id', 'occurred_at'], 'management_change_outlet_time_index');
            $table->foreign(['tenant_id', 'actor_membership_id'], 'management_change_actor_membership_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
            $table->foreign('actor_user_id', 'management_change_actor_user_foreign')
                ->references('id')->on('users')->restrictOnDelete();
            $table->foreign(['tenant_id', 'employee_id'], 'management_change_employee_foreign')
                ->references(['tenant_id', 'id'])->on('employees')->restrictOnDelete();
            $table->foreign(['tenant_id', 'outlet_id'], 'management_change_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        $connection = (string) config('database.default');
        $database = (string) config("database.connections.{$connection}.database");
        if (! app()->environment('testing') || $database !== 'hadirinaja_test') {
            throw new RuntimeException('Management audit migration is forward-only outside the isolated hadirinaja_test database.');
        }

        Schema::dropIfExists('management_change_events');
    }
};
