import type { ModelDefinition } from '@modeler/shared';
import type { Dao } from './dao.js';

/**
 * DAO レジストリ — デプロイ済みモデルの DAO 一覧を提供する。
 *
 * なぜ必要か:
 *   FK 整合性チェック (参照先 ID 実在確認 / cascade / setNull) は
 *   他モデルの DAO を呼び出す必要がある。各 DAO は自モデルしか知らないので、
 *   レジストリを後注入することで「自分以外の DAO」にアクセスできるようにする。
 *
 * 配線タイミング:
 *   DeployRegistry.deploy() 内で全 DAO の init() が完了してから注入する。
 *   それまでは未設定 (undefined) を許容し、注入前の整合性チェックは no-op にする。
 *   これにより既存テスト (DAO を単独で new するもの) もコンストラクタ変更なしで通る。
 */
export interface DaoRegistry {
  /** モデル名から対応する DAO を取得。未デプロイなら undefined。 */
  get(modelName: string): Dao | undefined;
  /** デプロイ済みの全モデル定義を返す。被参照スキャン用。 */
  models(): ModelDefinition[];
}

/**
 * 標準実装。モデル名 → DAO の Map をそのまま参照するだけのシンプルなもの。
 * 再デプロイ時は新しいインスタンスを作り直して各 DAO に setRegistry し直す。
 */
export class DaoRegistryImpl implements DaoRegistry {
  constructor(
    private readonly daoMap: Map<string, Dao>,
    private readonly modelList: ModelDefinition[],
  ) {}

  get(modelName: string): Dao | undefined {
    return this.daoMap.get(modelName);
  }

  models(): ModelDefinition[] {
    return this.modelList;
  }
}
