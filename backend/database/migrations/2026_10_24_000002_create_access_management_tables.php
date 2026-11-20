<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenant_memberships', function (Blueprint $table): void {
            $table->timestamp('revoked_at')->nullable()->after('is_active');
        });

        Schema::create('tenant_access_invitations', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('created_by_membership_id');
            $table->unsignedBigInteger('intended_user_id')->nullable();
            $table->unsignedBigInteger('employee_id')->nullable();
            $table->string('invitee_email')->collation('utf8mb4_bin');
            $table->enum('role', ['employee', 'supervisor']);
            $table->char('token_digest', 64)->unique();
            $table->timestamp('expires_at');
            $table->timestamp('accepted_at')->nullable();
            $table->unsignedBigInteger('accepted_by_user_id')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamps();
            $table->unique(['tenant_id', 'id'], 'tenant_access_invitation_identity_unique');
            $table->index(['tenant_id', 'invitee_email', 'role', 'accepted_at', 'revoked_at'], 'tenant_access_invitee_status_index');
            $table->index(['tenant_id', 'expires_at'], 'tenant_access_expiry_index');
            $table->foreign('tenant_id', 'tenant_access_invitation_tenant_foreign')
                ->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign(['tenant_id', 'created_by_membership_id'], 'tenant_access_invitation_creator_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
            $table->foreign('intended_user_id', 'tenant_access_invitation_intended_user_foreign')
                ->references('id')->on('users')->restrictOnDelete();
            $table->foreign(['tenant_id', 'employee_id'], 'tenant_access_invitation_employee_foreign')
                ->references(['tenant_id', 'id'])->on('employees')->restrictOnDelete();
            $table->foreign('accepted_by_user_id', 'tenant_access_invitation_acceptor_foreign')
                ->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('tenant_access_invitation_outlet_scopes', function (Blueprint $table): void {
            $table->innoDb();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('invitation_id');
            $table->unsignedBigInteger('outlet_id');
            $table->timestamps();
            $table->primary(['tenant_id', 'invitation_id', 'outlet_id'], 'tenant_invitation_scope_primary');
            $table->foreign(['tenant_id', 'invitation_id'], 'tenant_invitation_scope_invitation_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_access_invitations')->cascadeOnDelete();
            $table->foreign(['tenant_id', 'outlet_id'], 'tenant_invitation_scope_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        $connection = (string) config('database.default');
        $database = (string) config("database.connections.{$connection}.database");
        if (! app()->environment('testing') || $database !== 'hadirinaja_test') {
            throw new RuntimeException('Access management migration is forward-only outside the isolated hadirinaja_test database.');
        }

        Schema::dropIfExists('tenant_access_invitation_outlet_scopes');
        Schema::dropIfExists('tenant_access_invitations');
        Schema::table('tenant_memberships', function (Blueprint $table): void {
            $table->dropColumn('revoked_at');
        });
    }
};
