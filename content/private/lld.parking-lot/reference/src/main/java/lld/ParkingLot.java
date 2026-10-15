package lld;

import java.util.EnumMap;
import java.util.HashMap;
import java.util.Map;

/** A parking lot that puts each vehicle in the smallest free spot it fits. */
public final class ParkingLot {
    public enum SpotSize { SMALL, MEDIUM, LARGE }

    public enum Vehicle {
        MOTORCYCLE(SpotSize.SMALL), CAR(SpotSize.MEDIUM), BUS(SpotSize.LARGE);

        final SpotSize needs;

        Vehicle(SpotSize needs) {
            this.needs = needs;
        }
    }

    private final Map<SpotSize, Integer> free = new EnumMap<>(SpotSize.class);
    private final Map<String, SpotSize> parked = new HashMap<>();

    public ParkingLot(int small, int medium, int large) {
        if (small < 0 || medium < 0 || large < 0) {
            throw new IllegalArgumentException("spot counts must not be negative");
        }
        free.put(SpotSize.SMALL, small);
        free.put(SpotSize.MEDIUM, medium);
        free.put(SpotSize.LARGE, large);
    }

    public SpotSize park(String plate, Vehicle vehicle) {
        if (plate == null || plate.isBlank() || parked.containsKey(plate)) {
            throw new IllegalArgumentException("invalid or already parked: " + plate);
        }
        for (SpotSize size : SpotSize.values()) {
            if (size.compareTo(vehicle.needs) >= 0 && free.get(size) > 0) {
                free.merge(size, -1, Integer::sum);
                parked.put(plate, size);
                return size;
            }
        }
        return null;
    }

    public boolean leave(String plate) {
        SpotSize size = parked.remove(plate);
        if (size == null) {
            return false;
        }
        free.merge(size, 1, Integer::sum);
        return true;
    }

    public int free(SpotSize size) {
        return free.get(size);
    }

    public SpotSize spotOf(String plate) {
        return parked.get(plate);
    }
}
