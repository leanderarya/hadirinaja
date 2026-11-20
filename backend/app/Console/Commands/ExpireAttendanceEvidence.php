<?php

namespace App\Console\Commands;

use App\Services\AttendanceEvidenceExpirationService;
use Illuminate\Console\Command;
use Throwable;

class ExpireAttendanceEvidence extends Command
{
    protected $signature = 'attendance:evidence-expire {--dry-run : Report eligible evidence and safe orphan candidates without deleting files} {--limit=100 : Maximum evidence rows and orphan files to inspect (1-1000)}';

    protected $description = 'Expire private attendance photos after their 90-day retention period.';

    public function handle(AttendanceEvidenceExpirationService $expiration): int
    {
        $limit = filter_var($this->option('limit'), FILTER_VALIDATE_INT);
        if ($limit === false || $limit < 1 || $limit > 1000) {
            $this->error('The limit must be an integer between 1 and 1000.');

            return self::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');
        if (! $dryRun && ! (bool) config('attendance_evidence.deletion_enabled', false)) {
            $this->warn('Attendance evidence deletion is disabled. No evidence or files were changed. Use --dry-run to inspect candidates.');

            return self::SUCCESS;
        }

        try {
            $summary = $expiration->run($dryRun, $limit);
        } catch (Throwable) {
            $this->error('Evidence lifecycle processing stopped safely. Review service availability and retry after recovery.');

            return self::FAILURE;
        }

        $this->table(['Metric', 'Count'], [
            ['Mode', $dryRun ? 'dry-run' : 'deletion-enabled'],
            ['Expired evidence eligible', $summary['eligible']],
            ['Protected by legal hold', $summary['held']],
            ['Evidence deleted', $summary['deleted']],
            ['Evidence failures', $summary['failed']],
            ['Orphan candidates (24h+)', $summary['orphan_candidates']],
            ['Orphans deleted', $summary['orphans_deleted']],
            ['Orphan failures', $summary['orphan_failures']],
        ]);

        return $summary['failed'] > 0 || $summary['orphan_failures'] > 0 ? self::FAILURE : self::SUCCESS;
    }
}
