<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendance_evidence', function (Blueprint $table): void {
            $table->unique(['tenant_id', 'id'], 'attendance_evidence_tenant_identity_unique');
        });

        Schema::table('attendance_evidence_audit_events', function (Blueprint $table): void {
            $table->unsignedBigInteger('attendance_event_id')->nullable()->change();
            $table->unsignedBigInteger('attendance_evidence_id')->nullable()->change();
            $table->char('storage_key_hash', 64)->nullable()->after('attendance_evidence_id');
        });

        DB::statement("ALTER TABLE attendance_evidence_audit_events MODIFY action ENUM('view', 'download', 'deletion', 'expiration_attempt', 'expiration_retry', 'orphan_cleanup_attempt', 'orphan_cleanup') NOT NULL");
        DB::statement('ALTER TABLE attendance_evidence_audit_events ADD CONSTRAINT attendance_evidence_audit_reference_check CHECK ((attendance_event_id IS NULL AND attendance_evidence_id IS NULL) OR (attendance_event_id IS NOT NULL AND attendance_evidence_id IS NOT NULL))');

        Schema::create('attendance_evidence_legal_hold_events', function (Blueprint $table): void {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('attendance_evidence_id');
            $table->unsignedBigInteger('attendance_event_id');
            $table->string('hold_reference', 128);
            $table->enum('action', ['placed', 'released']);
            $table->unsignedBigInteger('actor_membership_id');
            $table->timestamp('occurred_at');
            $table->unique(['tenant_id', 'id'], 'attendance_evidence_hold_tenant_identity_unique');
            $table->index(['tenant_id', 'attendance_evidence_id', 'hold_reference', 'id'], 'attendance_evidence_hold_state_index');
            $table->foreign(['tenant_id', 'attendance_evidence_id', 'attendance_event_id'], 'attendance_evidence_hold_evidence_foreign')
                ->references(['tenant_id', 'id', 'attendance_event_id'])->on('attendance_evidence')->restrictOnDelete();
            $table->foreign(['tenant_id', 'actor_membership_id'], 'attendance_evidence_hold_actor_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
        });

    }

    public function down(): void
    {
        $connection = (string) config('database.default');
        $database = (string) config("database.connections.{$connection}.database");
        if (! app()->environment('testing') || $database !== 'hadirinaja_test') {
            throw new RuntimeException('Evidence expiration migrations are forward-only outside the isolated hadirinaja_test database.');
        }

        Schema::dropIfExists('attendance_evidence_legal_hold_events');
        // Test-only migration rollback discards its isolated audit fixtures before restoring the v1 enum/constraints.
        DB::table('attendance_evidence_audit_events')->delete();
        Schema::table('attendance_evidence', function (Blueprint $table): void {
            $table->dropUnique('attendance_evidence_tenant_identity_unique');
        });
        $checkConstraint = DB::connection()->isMaria() ? 'CONSTRAINT' : 'CHECK';
        DB::statement("ALTER TABLE attendance_evidence_audit_events DROP {$checkConstraint} attendance_evidence_audit_reference_check");
        DB::statement("ALTER TABLE attendance_evidence_audit_events MODIFY action ENUM('view', 'download', 'deletion') NOT NULL");
        Schema::table('attendance_evidence_audit_events', function (Blueprint $table): void {
            $table->dropColumn('storage_key_hash');
        });
        // The preceding test-only lifecycle rollback restores NOT NULL storage columns.
        DB::table('attendance_evidence')->whereNull('storage_path')->delete();
    }
};
