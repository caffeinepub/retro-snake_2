import Nat "mo:core/Nat";
import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";

actor {
  var globalHiScore = 0;

  let userScores = Map.empty<Principal, Nat>();

  public query ({ caller }) func getGlobalHiScore() : async Nat {
    globalHiScore;
  };

  public shared ({ caller }) func submitScore(score : Nat) : async () {
    switch (userScores.get(caller)) {
      case (null) { userScores.add(caller, score) };
      case (?currentScore) {
        if (score > currentScore) {
          userScores.add(caller, score);
        };
      };
    };

    if (score > globalHiScore) {
      globalHiScore := score;
    };
  };

  public query ({ caller }) func getUserHiScore(user : Principal) : async Nat {
    switch (userScores.get(user)) {
      case (null) { Runtime.trap("No score found for user") };
      case (?score) { score };
    };
  };
};
