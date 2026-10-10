package problems;

import java.util.ArrayDeque;
import java.util.Deque;

/** Checks that (), [] and {} are balanced and properly nested. */
public final class Brackets {
    private Brackets() {
    }

    public static boolean isBalanced(String text) {
        if (text == null) {
            throw new IllegalArgumentException("text is missing");
        }
        Deque<Character> open = new ArrayDeque<>();
        for (char c : text.toCharArray()) {
            if (c == '(' || c == '[' || c == '{') {
                open.push(c);
            } else if (c == ')' || c == ']' || c == '}') {
                if (open.isEmpty() || open.pop() != partner(c)) {
                    return false;
                }
            }
        }
        return open.isEmpty();
    }

    private static char partner(char closing) {
        return switch (closing) {
            case ')' -> '(';
            case ']' -> '[';
            default -> '{';
        };
    }
}
