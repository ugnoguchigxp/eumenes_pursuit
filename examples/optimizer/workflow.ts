export function optimizerWorkflow(candidateFile: string) {
	return [
		`最初の act で ${candidateFile} と README.md を、path を指定した2件の read_file としてまとめて読む。`,
		"候補を編集するときは、入力が揃っている write_file、check_candidate、measure_candidate、read_candidate を同じ act に順に含める。",
		"正しさに不合格の版は measure_candidate が実計測せずに拒否する。そこで残りの操作が止まったら、check_candidate の不一致情報を使って候補を修正する。",
		"actions が2件以上なら sequence=true にする。完了前に read_candidate の結果で現行版と最良版の一致を確認する。",
	].join("\n");
}
