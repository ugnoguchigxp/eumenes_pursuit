import type { EvalTask } from "../contracts.ts";
import { contradictoryRoom } from "./a/contradictory-room.ts";
import { missingBudget } from "./a/missing-budget.ts";
import { staleSupplierPrice } from "./a/stale-supplier-price.ts";
import { paginatedTimeoutArchive } from "./b/paginated-timeout-archive.ts";
import { primaryDownMirror } from "./b/primary-down-mirror.ts";
import { staleConfigManifest } from "./b/stale-config-manifest.ts";
import { laptopSelection } from "./c/laptops.ts";
import { vendorSelection } from "./c/vendors.ts";
import { venueSelection } from "./c/venues.ts";
import { businessDays } from "./d/business-days.ts";
import { parseDurationTask } from "./d/parse-duration.ts";
import { slugifyTask } from "./d/slugify.ts";
import { splitBill } from "./d/split-bill.ts";
import {
	horizon2Tasks,
	horizon3Tasks,
	horizonTasks,
} from "./e/horizon-problems.ts";
import { reasoningTasks } from "./e/problems.ts";

export const tasks: readonly EvalTask[] = [
	missingBudget,
	staleSupplierPrice,
	contradictoryRoom,
	primaryDownMirror,
	paginatedTimeoutArchive,
	staleConfigManifest,
	laptopSelection,
	venueSelection,
	vendorSelection,
	splitBill,
	businessDays,
	parseDurationTask,
	slugifyTask,
	...reasoningTasks,
	...horizonTasks,
	...horizon2Tasks,
	...horizon3Tasks,
];
