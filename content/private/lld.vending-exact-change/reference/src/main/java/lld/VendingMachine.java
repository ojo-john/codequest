package lld;

import java.util.EnumMap;
import java.util.HashMap;
import java.util.Map;

/** A vending machine: stock slots, take coins, sell items and give change from the coins it holds. */
public final class VendingMachine {
    /** Accepted coins, largest first (the order change is planned in). */
    private enum Coin {
        DOLLAR(100), QUARTER(25), DIME(10), NICKEL(5);

        final int cents;

        Coin(int cents) {
            this.cents = cents;
        }

        static Coin of(int cents) {
            for (Coin coin : values()) {
                if (coin.cents == cents) {
                    return coin;
                }
            }
            throw new IllegalArgumentException("coin not accepted: " + cents);
        }
    }

    private static final class Slot {
        final int price;
        int count;

        Slot(int price, int count) {
            this.price = price;
            this.count = count;
        }
    }

    private final Map<String, Slot> slots = new HashMap<>();
    private final Map<Coin, Integer> coins = new EnumMap<>(Coin.class);
    private int balance;

    public VendingMachine() {
        for (Coin coin : Coin.values()) {
            coins.put(coin, 0);
        }
    }

    public void stock(String code, int priceCents, int count) {
        if (code == null || code.isBlank() || priceCents <= 0 || priceCents % 5 != 0 || count <= 0) {
            throw new IllegalArgumentException("invalid stock");
        }
        Slot slot = slots.get(code);
        if (slot == null) {
            slots.put(code, new Slot(priceCents, count));
        } else if (slot.price != priceCents) {
            throw new IllegalArgumentException("slot " + code + " already has a different price");
        } else {
            slot.count += count;
        }
    }

    public void loadCoins(int cents, int count) {
        Coin coin = Coin.of(cents);
        if (count <= 0) {
            throw new IllegalArgumentException("count must be positive");
        }
        coins.merge(coin, count, Integer::sum);
    }

    public int coinCount(int cents) {
        return coins.get(Coin.of(cents));
    }

    public void insert(int cents) {
        Coin coin = Coin.of(cents);
        coins.merge(coin, 1, Integer::sum);
        balance += cents;
    }

    public int balance() {
        return balance;
    }

    public int remaining(String code) {
        Slot slot = slots.get(code);
        return slot == null ? 0 : slot.count;
    }

    public int select(String code) {
        Slot slot = slots.get(code);
        if (slot == null) {
            throw new IllegalArgumentException("no such slot: " + code);
        }
        if (slot.count == 0) {
            throw new IllegalStateException("sold out");
        }
        if (balance < slot.price) {
            throw new IllegalStateException("insert more money");
        }
        int change = balance - slot.price;
        Map<Coin, Integer> plan = planChange(change);
        if (plan == null) {
            throw new IllegalStateException("exact change only");
        }
        payOut(plan);
        slot.count--;
        balance = 0;
        return change;
    }

    public int cancel() {
        int refund = balance;
        // The coins just inserted are still held, so a refund can always be paid.
        payOut(planChange(refund));
        balance = 0;
        return refund;
    }

    /** Fewest coins; among equals, the most of each larger coin. Null if impossible. */
    private Map<Coin, Integer> planChange(int amount) {
        Map<Coin, Integer> best = null;
        int bestCoins = Integer.MAX_VALUE;
        for (int dollars = Math.min(coins.get(Coin.DOLLAR), amount / 100); dollars >= 0; dollars--) {
            int afterDollars = amount - 100 * dollars;
            for (int quarters = Math.min(coins.get(Coin.QUARTER), afterDollars / 25); quarters >= 0; quarters--) {
                int afterQuarters = afterDollars - 25 * quarters;
                for (int dimes = Math.min(coins.get(Coin.DIME), afterQuarters / 10); dimes >= 0; dimes--) {
                    int rest = afterQuarters - 10 * dimes;
                    int nickels = rest / 5;
                    if (rest % 5 != 0 || nickels > coins.get(Coin.NICKEL)) {
                        continue;
                    }
                    int total = dollars + quarters + dimes + nickels;
                    if (total < bestCoins) {
                        bestCoins = total;
                        best = new EnumMap<>(Map.of(Coin.DOLLAR, dollars, Coin.QUARTER, quarters, Coin.DIME, dimes, Coin.NICKEL, nickels));
                    }
                }
            }
        }
        return best;
    }

    private void payOut(Map<Coin, Integer> plan) {
        plan.forEach((coin, count) -> coins.merge(coin, -count, Integer::sum));
    }
}
