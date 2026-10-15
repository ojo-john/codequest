package lld;

/** A vending machine: stock slots, take coins, sell items and give change. */
public final class VendingMachine {
    /** Adds count items at priceCents to the slot (creating it if new). */
    public void stock(String code, int priceCents, int count) {
        throw new UnsupportedOperationException("not implemented yet");
    }

    /** Accepts one coin of 5, 10, 25 or 100 cents. */
    public void insert(int cents) {
        throw new UnsupportedOperationException("not implemented yet");
    }

    public int balance() {
        throw new UnsupportedOperationException("not implemented yet");
    }

    /** Items left in the slot (0 for an unknown slot). */
    public int remaining(String code) {
        throw new UnsupportedOperationException("not implemented yet");
    }

    /** Sells one item and returns the change in cents. */
    public int select(String code) {
        throw new UnsupportedOperationException("not implemented yet");
    }

    /** Ends the transaction and returns the balance in cents. */
    public int cancel() {
        throw new UnsupportedOperationException("not implemented yet");
    }
}
