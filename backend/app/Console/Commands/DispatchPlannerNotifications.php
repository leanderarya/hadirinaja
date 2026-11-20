<?php

namespace App\Console\Commands;

use App\Services\PlannerNotificationService;
use Illuminate\Console\Command;
use Throwable;

class DispatchPlannerNotifications extends Command
{
    protected $signature = 'planner:notifications-dispatch {--limit=100 : Maximum inbox deliveries (1-1000)}';

    protected $description = 'Queue due planner reminders and deliver the durable in-app notification outbox.';

    public function handle(PlannerNotificationService $notifications): int
    {
        $limit = filter_var($this->option('limit'), FILTER_VALIDATE_INT);
        if ($limit === false || $limit < 1 || $limit > 1000) {
            $this->error('Limit must be 1-1000.');

            return self::FAILURE;
        }
        try {
            $notifications->queueExpired();
            $reminders = $notifications->remindDue();
            $delivered = $notifications->dispatch($limit);
        } catch (Throwable) {
            $this->error('Planner dispatch stopped safely. Retry after restoring database availability.');

            return self::FAILURE;
        }
        $this->info("Queued reminders: {$reminders}; delivered: {$delivered}");

        return self::SUCCESS;
    }
}
