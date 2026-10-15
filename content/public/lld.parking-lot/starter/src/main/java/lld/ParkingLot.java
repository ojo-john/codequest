package lld;

/** A parking lot that puts each vehicle in the smallest free spot it fits. */
public final class ParkingLot {
    public enum SpotSize { SMALL, MEDIUM, LARGE }

    public enum Vehicle { MOTORCYCLE, CAR, BUS }

    public ParkingLot(int small, int medium, int large) {
        // Set up here.
    }

    /** Parks the vehicle and returns the size of spot used, or null if it doesn't fit anywhere. */
    public SpotSize park(String plate, Vehicle vehicle) {
        throw new UnsupportedOperationException("not implemented yet");
    }

    /** Frees the vehicle's spot; false if that plate isn't parked here. */
    public boolean leave(String plate) {
        throw new UnsupportedOperationException("not implemented yet");
    }

    public int free(SpotSize size) {
        throw new UnsupportedOperationException("not implemented yet");
    }

    /** Where the vehicle is parked, or null. */
    public SpotSize spotOf(String plate) {
        throw new UnsupportedOperationException("not implemented yet");
    }
}
