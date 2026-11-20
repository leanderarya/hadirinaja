<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('planner_notifications', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('membership_id');
            $table->unsignedBigInteger('employee_id')->nullable();
            $table->string('kind', 40);
            $table->string('event_key', 160);
            $table->json('data');
            $table->dateTime('delivered_at')->nullable();
            $table->dateTime('read_at')->nullable();
            $table->dateTime('created_at');
            $table->unique(['tenant_id', 'membership_id', 'event_key'], 'planner_notification_event_unique');
            $table->index(['delivered_at', 'id']);
            $table->index(['tenant_id', 'membership_id', 'id']);
            $table->foreign(['tenant_id', 'membership_id'])->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
            $table->foreign(['tenant_id', 'employee_id'])->references(['tenant_id', 'id'])->on('employees')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('planner_notifications');
    }
};
