<?php

namespace App\Console\Commands;

use App\Services\CorrectionEvidenceService;
use Illuminate\Console\Command;

final class ExpireCorrectionEvidence extends Command
{
    protected $signature = 'attendance:correction-evidence-expire {--dry-run} {--limit=100}';

    protected $description = 'Expire private correction attachments after their retention period.';

    public function handle(CorrectionEvidenceService $evidence): int
    {
        $limit = filter_var($this->option('limit'), FILTER_VALIDATE_INT);
        if ($limit === false || $limit < 1 || $limit > 1000) {
            $this->error('The limit must be an integer between 1 and 1000.');

            return self::FAILURE;
        }
        $dryRun = (bool) $this->option('dry-run');
        if (! $dryRun && ! config('attendance_evidence.correction_deletion_enabled')) {
            $this->warn('Correction evidence deletion is disabled.');

            return self::SUCCESS;
        }

        $summary = $evidence->expire($limit, $dryRun);
        $this->table(['Metric', 'Count'], collect($summary)->map(fn ($count, $metric) => [$metric, $count])->values()->all());

        return $summary['failed'] ? self::FAILURE : self::SUCCESS;
    }
}
