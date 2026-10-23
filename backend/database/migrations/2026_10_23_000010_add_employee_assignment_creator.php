<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_outlet_assignments', function (Blueprint $table): void {
            $table->unsignedBigInteger('created_by_membership_id')->nullable();
            $table->index(['tenant_id', 'created_by_membership_id'], 'employee_assignments_creator_index');
            $table->foreign(['tenant_id', 'created_by_membership_id'], 'employee_assignments_creator_membership_fk')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        $connection = (string) config('database.default');
        $database = (string) config("database.connections.{$connection}.database");

        if (! app()->environment('testing') || $database !== 'hadirinaja_test') {
            throw new RuntimeException('Employee assignment provenance migration is forward-only outside the isolated hadirinaja_test database.');
        }

        Schema::table('employee_outlet_assignments', function (Blueprint $table): void {
            $table->dropForeign('employee_assignments_creator_membership_fk');
            $table->dropIndex('employee_assignments_creator_index');
            $table->dropColumn('created_by_membership_id');
        });
    }
};
