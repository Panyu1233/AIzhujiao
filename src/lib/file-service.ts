import { listChildren, type FileNodeDTO } from './file-repo';

export interface ListParams {
  parentId?: string | null;
  searchKey?: string | null;
}

/**
 * 文件树查询的共享业务逻辑。
 * GET /v1/file/tree 与 POST /v1/file/list（FastGPT 官方）共用同一实现。
 */
export async function queryFileTree(params: ListParams): Promise<FileNodeDTO[]> {
  const parentId =
    params.parentId === undefined ||
    params.parentId === null ||
    (typeof params.parentId === 'string' &&
      (params.parentId.trim() === '' || params.parentId.trim() === 'null'))
      ? null
      : params.parentId;

  const searchKey =
    typeof params.searchKey === 'string' && params.searchKey.trim() !== ''
      ? params.searchKey
      : null;

  return listChildren({ parentId, searchKey });
}
