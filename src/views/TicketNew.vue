<template>
  <div class="ticket-new-page">
    <el-card shadow="never">
      <template #header>
        <div class="new-header">新建工单</div>
      </template>
      <el-form :model="form" label-width="100px">
        <el-form-item label="标题">
          <el-input v-model="form.title" placeholder="一句话概括问题" />
        </el-form-item>
        <el-form-item label="项目现场">
          <el-select
            v-model="form.siteId"
            placeholder="请选择项目现场"
            style="width: 100%"
            :loading="loadingSites"
            clearable
          >
            <el-option
              v-for="site in sites"
              :key="site.id"
              :label="site.name"
              :value="site.id"
            />
          </el-select>
          <div v-if="!loadingSites && sites.length === 0" class="site-tip">
            暂无可用现场，请联系管理员或研发预设
          </div>
        </el-form-item>
        <el-form-item label="车型">
          <el-select
            v-model="form.vehicleModelId"
            placeholder="请选择车型"
            style="width: 100%"
            :loading="loadingModels"
            filterable
          >
            <el-option-group v-for="cat in availableModelCategories" :key="cat.id" :label="cat.name">
              <el-option
                v-for="model in availableModelsByCategory[cat.id]"
                :key="model.id"
                :label="`${cat.name} - ${model.name}`"
                :value="model.id"
              />
            </el-option-group>
          </el-select>
          <div v-if="form.siteId && !loadingModels && availableModels.length === 0" class="site-tip">
            该现场未关联车型，请联系管理员配置
          </div>
        </el-form-item>
        <el-form-item label="问题描述">
          <el-input v-model="form.description" type="textarea" :rows="4" placeholder="请简要描述当前遇到的问题" />
        </el-form-item>
        <el-form-item label="发生时间">
          <el-date-picker
            v-model="occurredRange"
            type="datetimerange"
            range-separator="至"
            start-placeholder="开始时间"
            end-placeholder="结束时间"
            value-format="YYYY-MM-DDTHH:mm:ss"
            clearable
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="影响程度">
          <el-select v-model="form.impactLevel" placeholder="请选择影响程度" clearable style="width: 100%">
            <el-option label="低" value="low" />
            <el-option label="中" value="medium" />
            <el-option label="高" value="high" />
            <el-option label="紧急" value="critical" />
          </el-select>
        </el-form-item>
        <el-form-item label="上传文件">
          <el-upload
            ref="fileUpload"
            v-model:file-list="fileList"
            drag
            multiple
            :auto-upload="true"
            :before-upload="beforeUpload"
            :http-request="uploadFileAction"
            :on-remove="onFileRemove"
            action="#"
          >
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">
              将文件拖到此处，或 <em>点击上传</em>
            </div>
            <template #tip>
              <div class="upload-tip">
                支持 .log、.zip、.tar.gz 格式，单个文件不超过 50MB，总大小不超过 200MB。压缩包会自动解压，自动识别 .log 日志与 .json 地图。文件会在选择后自动上传。
              </div>
            </template>
            <template #file="{ file }">
              <div class="upload-file-item">
                <div class="upload-file-name">
                  <el-icon><Document /></el-icon>
                  <span>{{ file.name }}</span>
                  <span class="upload-file-size">({{ formatFileSize(file.size || 0) }})</span>
                </div>
                <el-progress
                  v-if="file.status === 'uploading'"
                  :percentage="file.percentage || 0"
                  :stroke-width="4"
                  :show-text="true"
                  status="primary"
                />
                <div v-else-if="file.status === 'success'" class="upload-file-status success">上传完成</div>
                <div v-else-if="file.status === 'fail'" class="upload-file-status error">上传失败</div>
              </div>
            </template>
          </el-upload>
        </el-form-item>
        <el-form-item label="AI 介入分析">
          <el-switch v-model="form.aiEnabled" active-text="开启" inactive-text="关闭" />
          <div class="ai-tip">开启后会调用大模型基于日志上下文和问题描述生成 AI 分析结论，耗时可能较长</div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="submitting" @click="onSubmit">提交工单</el-button>
          <el-button @click="router.back()">取消</el-button>
        </el-form-item>
      </el-form>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Document, UploadFilled } from '@element-plus/icons-vue'
import { useTicketStore } from '@/stores/tickets'
import { listSites, type Site } from '@/api/sites'
import { listCategories, listModels, type VehicleCategory, type VehicleModel } from '@/api/vehicles'
import { uploadTicketFiles } from '@/api/tickets'
import type { UploadFile, UploadRawFile, UploadRequestOptions, UploadUserFile } from 'element-plus'

const router = useRouter()
const ticketStore = useTicketStore()
const submitting = ref(false)
const error = ref('')

const form = reactive({
  title: '',
  description: '',
  siteId: undefined as number | undefined,
  vehicleModelId: undefined as number | undefined,
  impactLevel: undefined as string | undefined,
  aiEnabled: false
})

const occurredRange = ref<[string, string] | null>(null)

const fileList = ref<UploadUserFile[]>([])
const tempFileMap = ref<Map<string, string>>(new Map())
const MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024

const sites = ref<Site[]>([])
const loadingSites = ref(false)

const allCategories = ref<VehicleCategory[]>([])
const availableModels = ref<VehicleModel[]>([])
const loadingModels = ref(false)

const availableModelsByCategory = computed(() => {
  const map: Record<number, VehicleModel[]> = {}
  for (const m of availableModels.value) {
    ;(map[m.category_id] ??= []).push(m)
  }
  return map
})

const availableModelCategories = computed(() => {
  const ids = new Set(availableModels.value.map((m) => m.category_id))
  return allCategories.value.filter((c) => ids.has(c.id))
})

watch(() => form.siteId, async (newSiteId) => {
  form.vehicleModelId = undefined
  if (!newSiteId) {
    availableModels.value = []
    return
  }
  loadingModels.value = true
  try {
    availableModels.value = await listModels({ siteId: newSiteId })
  } catch {
    availableModels.value = []
  } finally {
    loadingModels.value = false
  }
})

onMounted(async () => {
  loadingSites.value = true
  try {
    ;[sites.value, allCategories.value] = await Promise.all([listSites(), listCategories()])
  } catch (e) {
    console.error('加载数据失败', e)
  } finally {
    loadingSites.value = false
  }
})

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

function currentTotalBytes(): number {
  return fileList.value.reduce((total, file) => total + (file.size || 0), 0)
}

function beforeUpload(rawFile: UploadRawFile): boolean {
  if (rawFile.size > MAX_SINGLE_FILE_BYTES) {
    error.value = '单个上传文件不能超过 50MB'
    return false
  }
  const wouldTotal = currentTotalBytes() + rawFile.size
  if (wouldTotal > MAX_UPLOAD_BYTES) {
    error.value = '所有上传文件总大小不能超过 200MB'
    return false
  }
  if (
    error.value === '所有上传文件总大小不能超过 200MB' ||
    error.value === '单个上传文件不能超过 50MB'
  ) {
    error.value = ''
  }
  return true
}

async function uploadFileAction(options: UploadRequestOptions) {
  const rawFile = options.file as File
  const uid = String(options.file.uid)
  try {
    const [info] = await uploadTicketFiles([rawFile], (percent) => {
      options.onProgress({ percent } as any)
    })
    tempFileMap.value.set(uid, info.tempFileId)
    options.onSuccess(info)
  } catch (e) {
    tempFileMap.value.delete(uid)
    options.onError(e as any)
  }
}

function onFileRemove(file: UploadFile) {
  tempFileMap.value.delete(String(file.uid))
  if (
    error.value === '所有上传文件总大小不能超过 200MB' ||
    error.value === '单个上传文件不能超过 50MB'
  ) {
    const total = currentTotalBytes()
    if (total <= MAX_UPLOAD_BYTES) {
      error.value = ''
    }
  }
}

function getTempFileIds(): string[] {
  return fileList.value
    .filter((f) => f.status === 'success' && tempFileMap.value.has(String(f.uid)))
    .map((f) => tempFileMap.value.get(String(f.uid))!)
}

function hasUploadingFiles(): boolean {
  return fileList.value.some((f) => f.status === 'uploading')
}

async function onSubmit() {
  error.value = ''
  if (!form.title.trim() || !form.description.trim()) {
    error.value = '标题和描述不能为空'
    return
  }
  if (!form.siteId) {
    error.value = '请选择项目现场'
    return
  }
  if (!form.vehicleModelId) {
    error.value = '请选择车型'
    return
  }
  if (fileList.value.length === 0) {
    error.value = '请至少上传一个文件'
    return
  }
  if (hasUploadingFiles()) {
    error.value = '请等待文件上传完成后再提交'
    return
  }
  const tempFileIds = getTempFileIds()
  if (tempFileIds.length === 0) {
    error.value = '文件上传未完成或失败，请重新上传'
    return
  }
  if (currentTotalBytes() > MAX_UPLOAD_BYTES) {
    error.value = '所有上传文件总大小不能超过 200MB'
    return
  }
  submitting.value = true
  try {
    const ticket = await ticketStore.createTicket({
      title: form.title.trim(),
      description: form.description.trim(),
      siteId: form.siteId,
      vehicleModelId: form.vehicleModelId,
      impactLevel: form.impactLevel,
      occurredStartAt: occurredRange.value?.[0],
      occurredEndAt: occurredRange.value?.[1],
      tempFileIds,
      aiEnabled: form.aiEnabled
    })
    router.push(`/tickets/${ticket.id}`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '提交失败'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.new-header {
  font-size: 16px;
  font-weight: 600;
}
.ai-tip {
  margin-left: 12px;
  font-size: 12px;
  color: #6b7280;
}
.site-tip {
  margin-top: 4px;
  font-size: 12px;
  color: #ef4444;
}
.upload-tip {
  font-size: 12px;
  color: #6b7280;
  margin-top: 8px;
  line-height: 1.5;
}
:deep(.el-upload-dragger) {
  width: 100%;
}
.upload-file-item {
  padding: 8px 0;
}
.upload-file-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #374151;
}
.upload-file-size {
  font-size: 12px;
  color: #9ca3af;
}
.upload-file-status {
  font-size: 12px;
  margin-top: 4px;
}
.upload-file-status.success {
  color: #22c55e;
}
.upload-file-status.error {
  color: #ef4444;
}
</style>
