package lld;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/** A vending machine: stock slots, take coins, sell items and give change. */
public final class VendingMachine {
    private static final Set<Integer> ACCEPTED_COINS = Set.of(5, 10, 25, 100);

    private static final class Slot {
        final int price;
        int count;

        Slot(int price, int count) {
            this.price = price;
            this.count = count;
        }
    }

    private final Map<String, Slot> slots = new HashMap<>();
    private int balance;

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

    public void insert(int cents) {
        if (!ACCEPTED_COINS.contains(cents)) {
            throw new IllegalArgumentException("coin not accepted: " + cents);
        }
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
        slot.count--;
        int change = balance - slot.price;
        balance = 0;
        return change;
    }

    public int cancel() {
        int refund = balance;
        balance = 0;
        return refund;
    }
}
