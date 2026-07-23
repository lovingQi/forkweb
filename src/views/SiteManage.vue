<template>
  <div class="site-manage-page">
    <el-card shadow="never">
      <template #header>
        <div class="list-header">
          <span>现场管理</span>
          <el-button type="primary" @click="openCreateDialog">新增现场</el-button>
        </div>
      </template>
      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="error-alert" />
      <el-table v-loading="loading" :data="sites" stripe>
        <el-table-column prop="name" label="现场名称" />
        <el-table-column label="关联车型" min-width="200">
          <template #default="{ row }">
            <template v-if="row.vehicleModelIds?.length">
              <el-tag v-for="mid in row.vehicleModelIds" :key="mid" size="small" style="margin: 2px">
                {{ getModelLabel(mid) }}
              </el-tag>
            </template>
            <span v-else style="color: #999">未关联</span>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="180" />
        <el-table-column prop="updatedAt" label="更新时间" width="180" />
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openEditDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑现场' : '新增现场'" width="560px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="现场名称">
          <el-input v-model="form.name" placeholder="例如：上海青浦仓库" />
        </el-form-item>
        <el-form-item label="关联车型">
          <el-select v-model="form.vehicleModelIds" multiple filterable collapse-tags collapse-tags-tooltip placeholder="选择该现场使用的车型" style="width: 100%">
            <el-option-group v-for="cat in vehicleCategories" :key="cat.id" :label="cat.name">
              <el-option v-for="model in vehicleModelsByCategory[cat.id] || []" :key="model.id" :label="`${cat.name} - ${model.name}`" :value="model.id" />
            </el-option-group>
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="onSubmit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createSite, deleteSite, listSites, updateSite, type Site } from '@/api/sites'
import { listCategories, listModels, type VehicleCategory, type VehicleModel } from '@/api/vehicles'

const sites = ref<Site[]>([])
const loading = ref(false)
const submitting = ref(false)
const error = ref('')

const vehicleCategories = ref<VehicleCategory[]>([])
const allVehicleModels = ref<VehicleModel[]>([])
const vehicleModelsByCategory = computed(() => {
  const map: Record<number, VehicleModel[]> = {}
  for (const m of allVehicleModels.value) {
    ;(map[m.category_id] ??= []).push(m)
  }
  return map
})

const dialogVisible = ref(false)
const isEdit = ref(false)
const form = reactive({
  id: 0,
  name: '',
  vehicleModelIds: [] as number[]
})

onMounted(async () => {
  await Promise.all([loadSites(), loadVehicleData()])
})

async function loadVehicleData() {
  try {
    ;[vehicleCategories.value, allVehicleModels.value] = await Promise.all([listCategories(), listModels()])
  } catch {
    // 车型数据加载失败不阻塞主流程
  }
}

async function loadSites() {
  loading.value = true
  error.value = ''
  try {
    sites.value = await listSites()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

function openCreateDialog() {
  isEdit.value = false
  form.id = 0
  form.name = ''
  form.vehicleModelIds = []
  error.value = ''
  dialogVisible.value = true
}

function openEditDialog(row: Site) {
  isEdit.value = true
  form.id = row.id
  form.name = row.name
  form.vehicleModelIds = [...(row.vehicleModelIds || [])]
  error.value = ''
  dialogVisible.value = true
}

async function onSubmit() {
  const name = form.name.trim()
  if (!name) {
    ElMessage.error('现场名称不能为空')
    return
  }
  submitting.value = true
  try {
    if (isEdit.value) {
      await updateSite(form.id, { name, vehicleModelIds: form.vehicleModelIds })
      ElMessage.success('更新成功')
    } else {
      await createSite({ name, vehicleModelIds: form.vehicleModelIds })
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    await loadSites()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    submitting.value = false
  }
}

function getModelLabel(modelId: number): string {
  const model = allVehicleModels.value.find((m) => m.id === modelId)
  return model ? `${model.category_name}-${model.name}` : `#${modelId}`
}

async function onDelete(row: Site) {
  try {
    await ElMessageBox.confirm(`确定要删除现场 "${row.name}" 吗？删除后不可恢复。`, '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'error'
    })
    await deleteSite(row.id)
    ElMessage.success('删除成功')
    await loadSites()
  } catch (e) {
    if (e === 'cancel' || (e instanceof Error && e.message === 'cancel')) return
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}
</script>

<style scoped>
.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.error-alert {
  margin-bottom: 12px;
}
</style>
