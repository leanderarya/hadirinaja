<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendance_corrections', function (Blueprint $table): void {
            $table->unsignedSmallInteger('contract_version')->default(1);
            $table->unsignedBigInteger('basis_correction_id')->nullable();
            $table->unique(['tenant_id', 'attendance_session_id', 'id'], 'correction_revision_identity');
            $table->foreign(['tenant_id', 'attendance_session_id', 'basis_correction_id'], 'correction_revision_basis_fk')
                ->references(['tenant_id', 'attendance_session_id', 'id'])->on('attendance_corrections');
        });
        DB::statement('ALTER TABLE attendance_corrections ADD CONSTRAINT correction_revision_contract_check CHECK (
            (contract_version = 1 AND basis_correction_id IS NULL) OR contract_version = 2
        )');
    }

    public function down(): void
    {
        if (DB::table('attendance_corrections')->where('contract_version', '>', 1)->exists()) {
            throw new RuntimeException('Correction revision rollback would discard recorded correction dependencies.');
        }

        $check = DB::connection()->isMaria() ? 'CONSTRAINT' : 'CHECK';
        DB::statement("ALTER TABLE attendance_corrections DROP {$check} correction_revision_contract_check");
        Schema::table('attendance_corrections', function (Blueprint $table): void {
            $table->dropForeign('correction_revision_basis_fk');
            $table->dropUnique('correction_revision_identity');
            $table->dropColumn(['basis_correction_id', 'contract_version']);
        });
    }
};
