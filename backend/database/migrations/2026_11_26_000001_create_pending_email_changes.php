<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pending_email_changes', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('membership_id');
            $table->unsignedBigInteger('user_id');
            $table->unsignedBigInteger('issued_by_membership_id');
            $table->string('old_email')->collation('utf8mb4_bin');
            $table->string('new_email')->collation('utf8mb4_bin');
            $table->char('token_digest', 64)->unique();
            $table->timestamp('expires_at');
            $table->timestamp('confirmed_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamps();
            $table->index(['tenant_id', 'membership_id', 'confirmed_at', 'revoked_at', 'expires_at'], 'pending_email_member_status_index');
            $table->index(['user_id', 'old_email', 'confirmed_at', 'revoked_at'], 'pending_email_user_status_index');
            $table->foreign(['tenant_id', 'membership_id'], 'pending_email_membership_fk')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
            $table->foreign('user_id', 'pending_email_user_fk')
                ->references('id')->on('users')->restrictOnDelete();
            $table->foreign(['tenant_id', 'issued_by_membership_id'], 'pending_email_issuer_fk')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        $connection = (string) config('database.default');
        if (! app()->environment('testing') || config("database.connections.{$connection}.database") !== 'hadirinaja_test') {
            throw new RuntimeException('Pending email change migration is forward-only outside hadirinaja_test.');
        }

        Schema::dropIfExists('pending_email_changes');
    }
};
