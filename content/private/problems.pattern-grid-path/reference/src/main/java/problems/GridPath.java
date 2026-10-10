package problems;

import java.util.ArrayDeque;
import java.util.Deque;

/** Fewest moves from S to E in a grid of open cells ('.') and walls ('#'). */
public final class GridPath {
    private static final int[][] STEPS = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};

    private GridPath() {
    }

    public static int shortest(String[] grid) {
        int rows = grid.length;
        int cols = grid[0].length();
        int[][] distance = new int[rows][cols];
        Deque<int[]> queue = new ArrayDeque<>();
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                distance[r][c] = -1;
                if (grid[r].charAt(c) == 'S') {
                    distance[r][c] = 0;
                    queue.add(new int[] {r, c});
                }
            }
        }
        while (!queue.isEmpty()) {
            int[] cell = queue.poll();
            int r = cell[0];
            int c = cell[1];
            if (grid[r].charAt(c) == 'E') {
                return distance[r][c];
            }
            for (int[] step : STEPS) {
                int nr = r + step[0];
                int nc = c + step[1];
                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr].charAt(nc) != '#' && distance[nr][nc] == -1) {
                    distance[nr][nc] = distance[r][c] + 1;
                    queue.add(new int[] {nr, nc});
                }
            }
        }
        return -1;
    }
}
