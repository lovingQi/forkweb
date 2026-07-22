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
            :auto-upload="false"
            :on-change="onFilesChange"
            :on-remove="onFilesChange"
            action="#"
          >
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">
              将文件拖到此处，或 <em>点击上传</em>
            </div>
            <template #tip>
              <div class="upload-tip">
                支持 .zip / .tar.gz / .tgz 压缩包自动解压，自动识别 .log 日志与 .json 地图。可一次选择多个文件或目录。
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
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { UploadFilled } from '@element-plus/icons-vue'
import { useTicketStore } from '@/stores/tickets'
import { listSites, type Site } from '@/api/sites'
import type { UploadFile, UploadUserFile } from 'element-plus'

const router = useRouter()
const ticketStore = useTicketStore()
const submitting = ref(false)
const error = ref('')

const form = reactive({
  title: '',
  description: '',
  siteId: undefined as number | undefined,
  impactLevel: undefined as string | undefined,
  aiEnabled: false
})

const occurredRange = ref<[string, string] | null>(null)

const fileList = ref<UploadUserFile[]>([])

const sites = ref<Site[]>([])
const loadingSites = ref(false)

onMounted(async () => {
  loadingSites.value = true
  try {
    sites.value = await listSites()
  } catch (e) {
    console.error('加载现场列表失败', e)
  } finally {
    loadingSites.value = false
  }
})

function onFilesChange() {
  // el-upload 会自动更新 fileList
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
  const rawFiles = fileList.value.map((f) => f.raw).filter(Boolean) as File[]
  if (rawFiles.length === 0) {
    error.value = '请至少上传一个文件'
    return
  }
  submitting.value = true
  try {
    const ticket = await ticketStore.createTicket({
      title: form.title.trim(),
      description: form.description.trim(),
      siteId: form.siteId,
      impactLevel: form.impactLevel,
      occurredStartAt: occurredRange.value?.[0],
      occurredEndAt: occurredRange.value?.[1],
      files: rawFiles,
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
</style>
