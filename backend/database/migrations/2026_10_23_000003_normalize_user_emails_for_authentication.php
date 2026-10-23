<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $hasCollisions = DB::table('users')
            ->selectRaw('LOWER(TRIM(email)) AS normalized_email')
            ->groupByRaw('LOWER(TRIM(email))')
            ->havingRaw('COUNT(*) > 1')
            ->exists();

        if ($hasCollisions) {
            throw new RuntimeException('User emails collide after authentication normalization; reconcile the affected accounts before retrying this migration.');
        }

        DB::table('users')->update(['email' => DB::raw('LOWER(TRIM(email))')]);
    }

    public function down(): void
    {
        $connection = (string) config('database.default');
        $database = (string) config("database.connections.{$connection}.database");

        if (! app()->environment('testing') || $database !== 'hadirinaja_test') {
            throw new RuntimeException('This migration is forward-only outside the isolated HadirinAja test database.');
        }
    }
};
