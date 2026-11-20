<?php

namespace App\Console\Commands;

use App\Services\AttendanceEvidenceLegalHoldService;
use Illuminate\Console\Command;
use Throwable;

class ExpireAttendanceEvidenceHolds extends Command
{
    protected $signature = 'attendance:evidence-holds-expire {--limit=1000 : Maximum evidence rows to inspect (1-1000)}';

    protected $description = 'Expire legal hold grants and pending preservation leases without deleting evidence files.';

    public function handle(AttendanceEvidenceLegalHoldService $holds): int
    {
        $limit = filter_var($this->option('limit'), FILTER_VALIDATE_INT);
        if ($limit === false || $limit < 1 || $limit > 1000) {
            $this->error('The limit must be an integer between 1 and 1000.');

            return self::FAILURE;
        }

        try {
            $count = $holds->expireDue($limit);
        } catch (Throwable) {
            $this->error('Legal hold expiry stopped safely. Review service availability and retry after recovery.');

            return self::FAILURE;
        }

        $this->info("Expired legal hold workflow records: {$count}");

        return self::SUCCESS;
    }
}
