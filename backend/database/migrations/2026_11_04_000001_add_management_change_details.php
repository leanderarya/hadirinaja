<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('management_change_events', function (Blueprint $table): void {
            $table->json('details')->nullable();
        });
    }

    public function down(): void
    {
        $connection = (string) config('database.default');
        if (! app()->environment('testing') || config("database.connections.{$connection}.database") !== 'hadirinaja_test') {
            throw new RuntimeException('Management audit migration is forward-only outside hadirinaja_test.');
        }
        Schema::table('management_change_events', fn (Blueprint $table) => $table->dropColumn('details'));
    }
};
