import {
  AbilityBuilder,
  PureAbility,
  type AbilityClass,
} from "@casl/ability";
import type { Role } from "@prisma/client";

type Action = "manage" | "create" | "read" | "update" | "delete";
type Subject =
  | "EvaluationItem"
  | "Score"
  | "Model"
  | "Prompt"
  | "Dimension"
  | "User"
  | "AntiCheatEvent"
  | "Analytics"
  | "all";

export type AppAbility = PureAbility<[Action, Subject]>;
const AppAbilityClass = PureAbility as AbilityClass<AppAbility>;

export function defineAbilityFor(role: Role, _userId: string): AppAbility {
  const { can, cannot, build } = new AbilityBuilder(AppAbilityClass);

  switch (role) {
    case "ADMIN":
      can("manage", "all");
      break;

    case "RESEARCHER":
      can("read", "EvaluationItem");
      can("read", "Score");
      can("read", "Model");
      can("read", "Prompt");
      can("read", "Dimension");
      can("read", "AntiCheatEvent");
      can("read", "Analytics");
      can("update", "Score");
      cannot("delete", "all");
      break;

    case "ANNOTATOR":
      can("read", "EvaluationItem");
      can("create", "Score");
      can("read", "Score");
      can("read", "Dimension");
      can("read", "Prompt");
      cannot("read", "AntiCheatEvent");
      cannot("read", "Analytics");
      break;

    case "VENDOR_ANNOTATOR":
      can("read", "EvaluationItem");
      can("create", "Score");
      can("read", "Score");
      can("read", "Dimension");
      cannot("read", "AntiCheatEvent");
      cannot("read", "Analytics");
      cannot("read", "User");
      break;

    case "REVIEWER":
      can("read", "EvaluationItem");
      can("read", "Score");
      can("update", "Score");
      can("read", "AntiCheatEvent");
      can("read", "Analytics");
      cannot("create", "Score");
      cannot("delete", "all");
      break;

    case "VIEWER":
      can("read", "Analytics");
      can("read", "Model");
      can("read", "Dimension");
      break;
  }

  return build();
}
