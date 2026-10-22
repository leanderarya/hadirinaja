<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenants', function (Blueprint $table) {
            $table->innoDb();
            $table->id();
            $table->string('name');
            $table->timestamps();
        });

        Schema::create('business_units', function (Blueprint $table) {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->string('name');
            $table->timestamps();
            $table->unique(['tenant_id', 'id']);
            $table->index(['tenant_id', 'name']);
            $table->foreign('tenant_id', 'business_units_tenant_foreign')
                ->references('id')->on('tenants')->restrictOnDelete();
        });

        Schema::create('outlets', function (Blueprint $table) {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('business_unit_id');
            $table->string('name');
            $table->timestamps();
            $table->unique(['tenant_id', 'id']);
            $table->index(['tenant_id', 'business_unit_id']);
            $table->foreign('tenant_id', 'outlets_tenant_foreign')
                ->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign(['tenant_id', 'business_unit_id'], 'outlets_tenant_business_unit_foreign')
                ->references(['tenant_id', 'id'])->on('business_units')->restrictOnDelete();
        });

        Schema::create('employees', function (Blueprint $table) {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->string('name');
            $table->timestamps();
            $table->unique(['tenant_id', 'id']);
            $table->index(['tenant_id', 'name']);
            $table->foreign('tenant_id', 'employees_tenant_foreign')
                ->references('id')->on('tenants')->restrictOnDelete();
        });

        Schema::create('tenant_memberships', function (Blueprint $table) {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('user_id');
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->unique(['tenant_id', 'user_id']);
            $table->unique(['tenant_id', 'id']);
            $table->foreign('tenant_id', 'tenant_memberships_tenant_foreign')
                ->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('user_id', 'tenant_memberships_user_foreign')
                ->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('tenant_role_assignments', function (Blueprint $table) {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('tenant_membership_id');
            $table->enum('role', ['owner', 'supervisor', 'employee']);
            $table->timestamps();
            $table->unique(['tenant_id', 'tenant_membership_id', 'role'], 'tenant_role_assignments_membership_role_unique');
            $table->unique(['tenant_id', 'id']);
            $table->index(['tenant_id', 'role']);
            $table->foreign(['tenant_id', 'tenant_membership_id'], 'tenant_roles_membership_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
        });

        Schema::create('supervisor_outlet_scopes', function (Blueprint $table) {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('tenant_membership_id');
            $table->unsignedBigInteger('outlet_id');
            $table->timestamps();
            $table->unique(['tenant_id', 'tenant_membership_id', 'outlet_id'], 'supervisor_scopes_membership_outlet_unique');
            $table->foreign(['tenant_id', 'tenant_membership_id'], 'supervisor_scopes_membership_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
            $table->foreign(['tenant_id', 'outlet_id'], 'supervisor_scopes_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
        });

        Schema::create('employee_user_links', function (Blueprint $table) {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('tenant_membership_id');
            $table->unsignedBigInteger('employee_id');
            $table->timestamps();
            $table->unique(['tenant_id', 'tenant_membership_id'], 'employee_user_links_membership_unique');
            $table->unique(['tenant_id', 'employee_id'], 'employee_user_links_employee_unique');
            $table->foreign(['tenant_id', 'tenant_membership_id'], 'employee_user_links_membership_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
            $table->foreign(['tenant_id', 'employee_id'], 'employee_user_links_employee_foreign')
                ->references(['tenant_id', 'id'])->on('employees')->restrictOnDelete();
        });

        Schema::create('employee_outlet_assignments', function (Blueprint $table) {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('employee_id');
            $table->unsignedBigInteger('outlet_id');
            $table->enum('assignment_type', ['primary', 'temporary']);
            $table->dateTime('effective_from');
            $table->dateTime('effective_until');
            $table->timestamps();
            $table->index(['tenant_id', 'employee_id', 'assignment_type', 'effective_from', 'effective_until'], 'employee_assignments_employee_effective_index');
            $table->index(['tenant_id', 'outlet_id', 'effective_from', 'effective_until'], 'employee_assignments_outlet_effective_index');
            $table->foreign(['tenant_id', 'employee_id'], 'employee_assignments_employee_foreign')
                ->references(['tenant_id', 'id'])->on('employees')->restrictOnDelete();
            $table->foreign(['tenant_id', 'outlet_id'], 'employee_assignments_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
        });

        DB::statement(
            'ALTER TABLE employee_outlet_assignments ADD CONSTRAINT employee_assignments_valid_range_check CHECK (effective_until > effective_from)'
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_outlet_assignments');
        Schema::dropIfExists('employee_user_links');
        Schema::dropIfExists('supervisor_outlet_scopes');
        Schema::dropIfExists('tenant_role_assignments');
        Schema::dropIfExists('tenant_memberships');
        Schema::dropIfExists('employees');
        Schema::dropIfExists('outlets');
        Schema::dropIfExists('business_units');
        Schema::dropIfExists('tenants');
    }
};
