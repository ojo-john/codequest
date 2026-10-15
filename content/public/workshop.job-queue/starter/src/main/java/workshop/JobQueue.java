package workshop;

/** Jobs run highest priority first; equal priorities run in submission order. */
public final class JobQueue {
    public void submit(String name, int priority) {
        throw new UnsupportedOperationException("not implemented yet");
    }

    /** Removes and returns the next job's name, or null if there are none. */
    public String next() {
        throw new UnsupportedOperationException("not implemented yet");
    }

    public int pending() {
        throw new UnsupportedOperationException("not implemented yet");
    }
}
