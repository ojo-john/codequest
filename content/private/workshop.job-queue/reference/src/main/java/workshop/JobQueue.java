package workshop;

import java.util.Comparator;
import java.util.PriorityQueue;

/** Jobs run highest priority first; equal priorities run in submission order. */
public final class JobQueue {
    private record Job(String name, int priority, long sequence) {
    }

    private final PriorityQueue<Job> jobs = new PriorityQueue<>(
            Comparator.comparingInt(Job::priority).reversed().thenComparingLong(Job::sequence));
    private long submitted;

    public void submit(String name, int priority) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("a job needs a name");
        }
        jobs.add(new Job(name, priority, submitted++));
    }

    public String next() {
        Job job = jobs.poll();
        return job == null ? null : job.name();
    }

    public int pending() {
        return jobs.size();
    }
}
