# Parking lot

A lot has small, medium and large spots. A motorcycle fits any spot, a car needs medium or
large, a bus needs large.

| Member | Contract |
|---|---|
| `new ParkingLot(small, medium, large)` | Spot counts; a negative count throws `IllegalArgumentException`. |
| `park(plate, vehicle)` | Puts the vehicle in the **smallest free spot it fits** and returns that spot's size, or `null` if none is free. A blank or `null` plate, or a plate already parked, throws `IllegalArgumentException`. |
| `leave(plate)` | Frees that vehicle's spot and returns `true`; `false` if the plate isn't parked. |
| `free(size)` | Free spots of that size. |
| `spotOf(plate)` | The size of the spot the vehicle is in, or `null`. |

The enums are given; you may add fields and constructors to them. Interviewers care that a
new vehicle or spot type would be a small, local change: avoid spreading `if (vehicle == CAR)`
across the class.
