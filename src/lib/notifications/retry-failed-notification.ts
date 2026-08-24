import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import type { SchedulingRepository } from "@/lib/scheduling/repository";

/** Admin's manual "retry" for one terminal-failed notification row — refuses anything not currently 'failed', never silently no-ops on the wrong row. */
export async function retryFailedNotification(repo: SchedulingRepository, notificationId: string): Promise<void> {
  const notification = await repo.findServiceVisitNotificationById(notificationId);
  if (!notification) {
    throw new InvalidVisitStateError(`service_visit_notification ${notificationId} not found`);
  }
  if (notification.state !== "failed") {
    throw new InvalidVisitStateError(`service_visit_notification ${notificationId} is not in a retryable state (state=${notification.state})`);
  }
  await repo.retryFailedServiceVisitNotification(notificationId);
}
