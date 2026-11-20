<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('schedule_revisions', function (Blueprint $table): void {
            $table->json('staffing')->nullable();
            $table->json('publication_warnings')->nullable();
        });
    }

    public function down(): void
    {
        if (! app()->environment('testing') || DB::connection()->getDatabaseName() !== 'hadirinaja_test') {
            throw new RuntimeException('Staffing rollback is restricted to the disposable test database.');
        }
        Schema::table('schedule_revisions', fn (Blueprint $table) => $table->dropColumn(['staffing', 'publication_warnings']));
    }
};
