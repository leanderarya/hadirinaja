<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private const ACTIONS = "'approved', 'rejected', 'cancelled', 'routine_applied', 'review_accepted', 'review_rejected', 'finalized'";

    public function up(): void
    {
        DB::statement('ALTER TABLE approval_decisions MODIFY action ENUM('.self::ACTIONS.", 'reversed') NOT NULL");
    }

    public function down(): void
    {
        if (DB::table('approval_decisions')->where('action', 'reversed')->exists()) {
            throw new RuntimeException('Cannot remove correction reversal support after a reversal has been recorded.');
        }

        DB::statement('ALTER TABLE approval_decisions MODIFY action ENUM('.self::ACTIONS.') NOT NULL');
    }
};
