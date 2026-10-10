package problems;

import java.util.Arrays;

/** A stack of ints backed by an array that doubles when it fills up. */
public final class IntStack {
    private int[] items = new int[4];
    private int size;

    public void push(int value) {
        if (size == items.length) {
            items = Arrays.copyOf(items, items.length * 2);
        }
        items[size++] = value;
    }

    public int pop() {
        int top = peek();
        size--;
        return top;
    }

    public int peek() {
        if (size == 0) {
            throw new IllegalStateException("the stack is empty");
        }
        return items[size - 1];
    }

    public boolean isEmpty() {
        return size == 0;
    }

    public int size() {
        return size;
    }
}
