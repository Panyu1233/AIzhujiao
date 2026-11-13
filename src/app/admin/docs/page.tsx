import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

type ParamDoc = {
  name: string;
  type: string;
  required?: boolean;
  description: string;
};

type EndpointDoc = {
  id: string;
  title: string;
  method: 'GET' | 'POST';
  path: string;
  summary: string;
  params: ParamDoc[];
  response: string;
  notes: string[];
};

const BASE_URL = config.publicBaseUrl || 'https://你的阿里云域名';

const ENDPOINTS: EndpointDoc[] = [
  {
    id: 'knowledge-files',
    title: '本地正式库文件',
    method: 'GET',
    path: '/api/open/v1/knowledge-files',
    summary: '查看底层知识库正式库（active）中已经解析入库的全部本地文件。',
    params: [
      { name: 'keyword', type: 'string', description: '按文件相对路径或文件名模糊搜索。' },
      { name: 'format', type: 'string', description: '按格式筛选，例如 DOCX、PDF、XLSX。' },
      { name: 'page', type: 'number', description: '页码，默认 1。' },
      { name: 'pageSize', type: 'number', description: '每页条数，默认 20，最大 100。' },
    ],
    response: `{
  "success": true,
  "message": "",
  "data": {
    "items": [
      {
        "id": "用户档案/张三_13800000000.docx",
        "name": "张三_13800000000.docx",
        "path": "用户档案/张三_13800000000.docx",
        "zone": "active",
        "format": "DOCX",
        "size": 28672,
        "createTime": "2026-11-11T02:10:00.000Z",
        "updateTime": "2026-11-11T02:10:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20
  }
}`,
    notes: [
      '只读取本地 knowledge-base/active 正式库，不返回 staging 暂存文件。',
      '支持子目录；不会跟随符号链接。',
      '文件内容不会内联返回，本接口用于查看文件清单与元数据。',
    ],
  },
  {
    id: 'staging-upload',
    title: '上传到暂存区',
    method: 'POST',
    path: '/api/open/upload',
    summary: '把一个文件上传到底层知识库暂存区，只落本地 staging 目录，不进入正式库，也不写 Supabase 或火山知识库。',
    params: [
      { name: 'file', type: 'File', required: true, description: 'multipart/form-data 文件字段，单次上传一个文件。' },
    ],
    response: `{
  "success": true,
  "message": "上传成功，等待审核",
  "data": {
    "name": "待审核文档.docx",
    "size": 28672
  }
}`,
    notes: [
      '请求必须携带 Authorization: Bearer <API_TOKEN>。',
      '文件写入服务器本地 STAGING_ROOT，修改代码和部署不会覆盖 knowledge-base 中原有暂存文件。',
      '只有后台点击“确认入库”后才进入本地正式库；Supabase 和火山知识库均在正式库后续操作中才写入。',
      '文件名重复时自动追加 (2)、(3)，不会覆盖服务器上已有暂存文件。',
    ],
  },
  {
    id: 'agent-users',
    title: '智能体原始用户',
    method: 'GET',
    path: '/api/open/v1/agent-users',
    summary: '查看 Supabase 智能体原始用户信息表 user_info_agent 的全部记录。',
    params: [
      { name: 'phone', type: 'string', description: '按手机号模糊搜索。' },
      { name: 'keyword', type: 'string', description: '按手机号、昵称或真实姓名模糊搜索。' },
      { name: 'calibrationStatus', type: 'string', description: '校准状态：success、failed 或 pending。' },
      { name: 'page', type: 'number', description: '页码，默认 1。' },
      { name: 'pageSize', type: 'number', description: '每页条数，默认 20，最大 100。' },
    ],
    response: `{
  "success": true,
  "message": "",
  "data": {
    "items": [
      {
        "id": 1,
        "phone": "13800000000",
        "nick_name": "张三",
        "real_name": null,
        "calibration_status": "success",
        "calibrated_user_id": 18,
        "created_at": "2026-11-11T02:00:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20,
    "table": "user_info_agent",
    "source": "supabase"
  }
}`,
    notes: [
      '数据来自 ALZHUJIAO_SUPABASE_URL 对应的官方 Supabase。',
      '实际表名会加本项目前缀，默认是 ai_teacher_user_info_agent。',
      '返回该表当前全部字段，便于后续字段扩展。',
    ],
  },
  {
    id: 'calibrated-users',
    title: '校准后统一用户',
    method: 'GET',
    path: '/api/open/v1/calibrated-users',
    summary: '查看以手机号为索引、由智能体用户和小程序用户校准生成的统一用户信息。',
    params: [
      { name: 'phone', type: 'string', description: '按手机号模糊搜索。' },
      { name: 'keyword', type: 'string', description: '按手机号、昵称或真实姓名模糊搜索。' },
      { name: 'calibrationStatus', type: 'string', description: '校准状态：success、failed 或 pending。' },
      { name: 'page', type: 'number', description: '页码，默认 1。' },
      { name: 'pageSize', type: 'number', description: '每页条数，默认 20，最大 100。' },
    ],
    response: `{
  "success": true,
  "message": "",
  "data": {
    "items": [
      {
        "id": 18,
        "phone": "13800000000",
        "nick_name": "张三",
        "source_type": "calibrated",
        "calibration_status": "success",
        "calibration_at": "2026-11-11T02:20:00.000Z",
        "calibration_message": "手机号匹配成功"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20,
    "table": "user_info",
    "source": "supabase"
  }
}`,
    notes: [
      '固定筛选 source_type=calibrated，只返回校准生成的统一用户记录。',
      '实际表名默认是 ai_teacher_user_info。',
      '手机号是关联智能体用户、小程序用户和聊天记录的核心索引。',
    ],
  },
  {
    id: 'chat-messages',
    title: '用户聊天记录',
    method: 'GET',
    path: '/api/open/v1/chat-messages',
    summary: '查看已经上传数据库的用户聊天记录，并按手机号补充校准后的用户信息。',
    params: [
      { name: 'phone', type: 'string', description: '按手机号筛选，并关联校准用户表。' },
      { name: 'keyword', type: 'string', description: '按消息正文模糊搜索。' },
      { name: 'direction', type: 'string', description: '消息方向筛选。' },
      { name: 'msgType', type: 'string', description: '消息类型筛选。' },
      { name: 'from', type: 'string', description: '开始日期，格式 YYYY-MM-DD。' },
      { name: 'to', type: 'string', description: '结束日期，格式 YYYY-MM-DD。' },
      { name: 'page', type: 'number', description: '页码，默认 1。' },
      { name: 'pageSize', type: 'number', description: '每页条数，默认 20，最大 100。' },
    ],
    response: `{
  "success": true,
  "message": "",
  "data": {
    "items": [
      {
        "message_id": 1001,
        "phone_snapshot": "13800000000",
        "user_phone": "13800000000",
        "user_name": "张三",
        "group_id": "group-001",
        "msg_type": "text",
        "content": "你好，我想了解检测流程",
        "send_time": "2026-11-11T03:00:00.000Z",
        "msg_direction": "inbound",
        "is_ai_reply": 0
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20,
    "stats": {
      "total": 1,
      "today": 1,
      "sensitive": 0
    }
  }
}`,
    notes: [
      '数据来自聊天记录表 chat_message，默认实际表名为 ai_teacher_chat_message。',
      'phone 参数会同时匹配聊天记录手机号快照和校准用户表手机号。',
      '只返回未删除的记录，按发送时间倒序排列。',
    ],
  },
];

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-stone-800/80 bg-stone-900">
      <div className="border-b border-stone-700/60 px-4 py-1.5 text-xs text-stone-400">
        {title}
      </div>
      <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-stone-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function ParamTable({ params }: { params: ParamDoc[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs text-stone-500">
          <tr>
            <th className="px-3 py-2 font-medium">参数</th>
            <th className="px-3 py-2 font-medium">类型</th>
            <th className="px-3 py-2 font-medium">必填</th>
            <th className="px-3 py-2 font-medium">说明</th>
          </tr>
        </thead>
        <tbody>
          {params.map((param) => (
            <tr key={param.name} className="border-t border-stone-100 text-stone-700">
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-emerald-800">{param.name}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-stone-500">{param.type}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">
                {param.required ? <Badge className="bg-rose-600">是</Badge> : <span className="text-stone-400">否</span>}
              </td>
              <td className="px-3 py-2">{param.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EndpointSection({ endpoint }: { endpoint: EndpointDoc }) {
  const curl = endpoint.method === 'POST'
    ? `curl -X POST "${BASE_URL}${endpoint.path}" \\
  -H "Authorization: Bearer <API_TOKEN>" \\
  -F "file=@待上传文件.docx"`
    : `curl "${BASE_URL}${endpoint.path}?page=1&pageSize=20" \\
  -H "Authorization: Bearer <API_TOKEN>"`;

  return (
    <section id={endpoint.id} className="scroll-mt-20 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={endpoint.method === 'POST' ? 'bg-sky-700' : 'bg-emerald-700'}>
          {endpoint.method}
        </Badge>
        <code className="font-mono text-sm text-stone-800">{endpoint.path}</code>
        <span className="text-xs text-stone-400">{endpoint.title}</span>
      </div>
      <p className="text-sm leading-relaxed text-stone-600">{endpoint.summary}</p>

      <Card className="bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-stone-600">请求参数</CardTitle>
        </CardHeader>
        <CardContent>
          <ParamTable params={endpoint.params} />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <CodeBlock title="请求示例" code={curl} />
        <CodeBlock title="响应示例" code={endpoint.response} />
      </div>

      <ul className="list-inside list-disc space-y-1 text-xs leading-relaxed text-stone-500">
        {endpoint.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </section>
  );
}

export default function ApiDocsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-stone-800">API 文档</h1>
        <p className="mt-1 text-sm text-stone-500">
          本地知识库、暂存上传与用户数据接口。旧的文件库对接文档已全部移除。
        </p>
      </div>

      <Card className="bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-stone-600">调用约定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 text-sm text-stone-700 md:grid-cols-2">
            <div>
              <span className="block text-xs text-stone-400">Base URL</span>
              <code className="mt-1 block rounded bg-stone-100 px-2 py-1.5 font-mono text-xs text-emerald-900">
                {BASE_URL}
              </code>
            </div>
            <div>
              <span className="block text-xs text-stone-400">鉴权请求头</span>
              <code className="mt-1 block rounded bg-stone-100 px-2 py-1.5 font-mono text-xs text-emerald-900">
                Authorization: Bearer &lt;API_TOKEN&gt;
              </code>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-stone-500">
            所有受保护接口均要求 Bearer Token。地址优先读取 PUBLIC_BASE_URL；阿里云域名配置后，此页面会自动显示正式地址。
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {ENDPOINTS.map((endpoint) => (
              <a
                key={endpoint.id}
                href={`#${endpoint.id}`}
                className="rounded-lg border border-stone-200 px-3 py-2 transition-colors hover:border-emerald-300 hover:bg-emerald-50"
              >
                <span className="block text-sm font-medium text-stone-700">{endpoint.title}</span>
                <code className="mt-1 block truncate font-mono text-[11px] text-stone-400">{endpoint.path}</code>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="space-y-2 p-4 text-sm text-amber-900">
          <p className="font-medium">统一响应格式</p>
          <p>成功：<code className="font-mono text-xs">{'{"success":true,"message":"","data":...}'}</code></p>
          <p>失败：<code className="font-mono text-xs">{'{"success":false,"message":"...","error":{"code":"..."}}'}</code></p>
        </CardContent>
      </Card>

      <Card className="bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-stone-600">接口目录</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-stone-700">
          {ENDPOINTS.map((endpoint) => (
            <div key={endpoint.id} className="flex flex-wrap items-center gap-3 rounded-md border border-stone-100 px-3 py-2">
              <Badge className={endpoint.method === 'POST' ? 'bg-sky-700' : 'bg-emerald-700'}>
                {endpoint.method}
              </Badge>
              <code className="font-mono text-xs text-stone-700">{endpoint.path}</code>
              <span className="ml-auto text-xs text-stone-400">{endpoint.title}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {ENDPOINTS.map((endpoint) => (
        <EndpointSection key={endpoint.id} endpoint={endpoint} />
      ))}
    </div>
  );
}
