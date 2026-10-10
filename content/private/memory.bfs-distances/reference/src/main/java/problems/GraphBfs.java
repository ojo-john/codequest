package problems;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.List;

/** Breadth-first search distances in an undirected graph. */
public final class GraphBfs {
    private GraphBfs() {
    }

    public static int[] distances(int n, int[][] edges, int start) {
        if (start < 0 || start >= n) {
            throw new IllegalArgumentException("start must be a vertex");
        }
        List<List<Integer>> graph = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            graph.add(new ArrayList<>());
        }
        for (int[] edge : edges) {
            graph.get(edge[0]).add(edge[1]);
            graph.get(edge[1]).add(edge[0]);
        }
        int[] distance = new int[n];
        Arrays.fill(distance, -1);
        distance[start] = 0;
        Deque<Integer> queue = new ArrayDeque<>();
        queue.add(start);
        while (!queue.isEmpty()) {
            int node = queue.poll();
            for (int next : graph.get(node)) {
                if (distance[next] == -1) {
                    distance[next] = distance[node] + 1;
                    queue.add(next);
                }
            }
        }
        return distance;
    }
}
