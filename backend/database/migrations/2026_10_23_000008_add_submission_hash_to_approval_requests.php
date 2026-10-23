<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('approval_requests', function (Blueprint $table): void {
            $table->char('submission_hash', 64)->nullable()->after('submission_key');
        });
    }

    public function down(): void
    {
        $connection = (string) config('database.default');
        $database = (string) config("database.connections.{$connection}.database");
        if (! app()->environment('testing') || $database !== 'hadirinaja_test') {
            throw new RuntimeException('Approval request idempotency migration is forward-only outside the isolated hadirinaja_test database.');
        }

        Schema::table('approval_requests', function (Blueprint $table): void {
            $table->dropColumn('submission_hash');
        });
    }
};
