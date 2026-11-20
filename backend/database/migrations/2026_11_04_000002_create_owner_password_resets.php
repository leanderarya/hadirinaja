<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('owner_password_resets', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('user_id');
            $table->unsignedBigInteger('target_membership_id');
            $table->unsignedBigInteger('issued_by_membership_id');
            $table->string('email');
            $table->char('token_digest', 64)->unique();
            $table->char('password_fingerprint', 64);
            $table->timestamp('expires_at');
            $table->timestamp('used_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamps();
            $table->index(['user_id', 'used_at', 'revoked_at']);
            $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete();
            $table->foreign(['tenant_id', 'target_membership_id'], 'password_reset_target_fk')->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
            $table->foreign(['tenant_id', 'issued_by_membership_id'], 'password_reset_issuer_fk')->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        $connection = (string) config('database.default');
        if (! app()->environment('testing') || config("database.connections.{$connection}.database") !== 'hadirinaja_test') {
            throw new RuntimeException('Password reset migration is forward-only outside hadirinaja_test.');
        }
        Schema::dropIfExists('owner_password_resets');
    }
};
