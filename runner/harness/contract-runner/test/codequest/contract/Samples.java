package codequest.contract;

import java.util.ArrayList;
import java.util.List;

/** Learner-style classes the runner tests execute against. */
final class Samples {
    private Samples() {
    }

    enum Size { SMALL, LARGE }

    record Item(String sku, long priceCents) {
    }

    static final class Cart {
        private final List<Item> items = new ArrayList<>();

        void add(Item item) {
            if (item.priceCents() < 0) {
                throw new IllegalArgumentException("negative price");
            }
            items.add(item);
        }

        long totalCents() {
            long total = 0;
            for (Item item : items) {
                total += item.priceCents();
            }
            return total;
        }

        List<Item> items() {
            return items;
        }
    }

    static final class Node {
        Node next = this;
    }

    static int sum(List<Integer> values) {
        int total = 0;
        for (int value : values) {
            total += value;
        }
        return total;
    }

    static int[][] transpose(int[][] matrix) {
        int[][] out = new int[matrix[0].length][matrix.length];
        for (int r = 0; r < matrix.length; r++) {
            for (int c = 0; c < matrix[0].length; c++) {
                out[c][r] = matrix[r][c];
            }
        }
        return out;
    }

    static String label(Size size, char suffix) {
        return size.name() + suffix;
    }

    static long twice(long value) {
        return value * 2;
    }

    static double ratio(double a, double b) {
        return a / b;
    }

    static Node cyclic() {
        return new Node();
    }

    static int overloaded(int value) {
        return value;
    }

    static int overloaded(long value) {
        return -1;
    }

    private static int secret() {
        return 7;
    }
}
