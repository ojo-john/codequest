package problems;

import java.util.ArrayList;
import java.util.List;

/** Ranks players by score. */
public final class Ranking {
    private Ranking() {
    }

    private record Player(String name, int score) {
    }

    /** Names ordered from highest score to lowest; equal scores keep their input order. */
    public static String[] byScore(String[] names, int[] scores) {
        List<Player> players = new ArrayList<>();
        for (int i = 0; i < names.length; i++) {
            players.add(new Player(names[i], scores[i]));
        }
        players.sort((a, b) -> b.score() - a.score());
        return players.stream().map(Player::name).toArray(String[]::new);
    }
}
