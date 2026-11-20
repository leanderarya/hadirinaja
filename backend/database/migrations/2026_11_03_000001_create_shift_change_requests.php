<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('schedule_entries', fn (Blueprint $table) => $table->unique(['tenant_id', 'id'], 'schedule_entry_tenant_id_unique'));
        Schema::create('shift_change_requests', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('outlet_id');
            $table->unsignedBigInteger('requester_id');
            $table->unsignedBigInteger('recipient_id');
            $table->unsignedBigInteger('actor_membership_id');
            $table->unsignedBigInteger('source_entry_id');
            $table->unsignedBigInteger('target_entry_id')->nullable();
            $table->enum('kind', ['swap', 'replacement']);
            $table->enum('status', ['pending', 'accepted', 'rejected', 'cancelled', 'expired'])->default('pending');
            $table->text('reason');
            $table->json('versions');
            $table->json('result')->nullable();
            $table->string('idempotency_key', 100);
            $table->char('request_hash', 64);
            $table->dateTime('expires_at');
            $table->dateTime('responded_at')->nullable();
            $table->timestamps();
            $table->unique(['tenant_id', 'actor_membership_id', 'idempotency_key'], 'shift_change_request_key');
            $table->index(['tenant_id', 'recipient_id', 'status']);
            foreach (['outlet_id' => 'outlets', 'requester_id' => 'employees', 'recipient_id' => 'employees', 'actor_membership_id' => 'tenant_memberships', 'source_entry_id' => 'schedule_entries', 'target_entry_id' => 'schedule_entries'] as $column => $target) {
                $table->foreign(['tenant_id', $column])->references(['tenant_id', 'id'])->on($target)->restrictOnDelete();
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shift_change_requests');
        Schema::table('schedule_entries', fn (Blueprint $table) => $table->dropUnique('schedule_entry_tenant_id_unique'));
    }
};
