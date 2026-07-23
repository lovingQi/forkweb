<template>
  <div class="vehicle-manage-page">
    <!-- 类别管理 -->
    <el-card shadow="never" class="section-card">
      <template #header>
        <div class="list-header">
          <span>车型类别</span>
          <el-button type="primary" @click="openCategoryDialog()">新增类别</el-button>
        </div>
      </template>
      <el-alert v-if="categoryError" :title="categoryError" type="error" show-icon :closable="false" class="error-alert" />
      <el-table v-loading="categoryLoading" :data="categories" stripe>
        <el-table-column prop="name" label="类别名称" />
        <el-table-column prop="created_at" label="创建时间" width="180" />
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openCategoryDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="onDeleteCategory(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 型号管理 -->
    <el-card shadow="never" class="section-card">
      <template #header>
        <div class="list-header">
          <span>车型型号</span>
          <div class="header-actions">
            <el-select v-model="filterCategoryId" placeholder="按类别筛选" clearable style="width: 180px; margin-right: 12px" @change="loadModels">
              <el-option v-for="cat in categories" :key="cat.id" :label="cat.name" :value="cat.id" />
            </el-select>
            <el-button type="primary" :disabled="categories.length === 0" @click="openModelDialog()">新增型号</el-button>
          </div>
        </div>
      </template>
      <el-alert v-if="modelError" :title="modelError" type="error" show-icon :closable="false" class="error-alert" />
      <el-table v-loading="modelLoading" :data="models" stripe>
        <el-table-column prop="category_name" label="所属类别" width="150" />
        <el-table-column prop="name" label="型号名称" />
        <el-table-column prop="created_at" label="创建时间" width="180" />
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openModelDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="onDeleteModel(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 类别对话框 -->
    <el-dialog v-model="categoryDialogVisible" :title="editingCategory ? '编辑类别' : '新增类别'" width="450px">
      <el-form :model="categoryForm" label-width="100px">
        <el-form-item label="类别名称">
          <el-input v-model="categoryForm.name" placeholder="例如：叉车、差速车" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="categoryDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="onSubmitCategory">保存</el-button>
      </template>
    </el-dialog>

    <!-- 型号对话框 -->
    <el-dialog v-model="modelDialogVisible" :title="editingModel ? '编辑型号' : '新增型号'" width="450px">
      <el-form :model="modelForm" label-width="100px">
        <el-form-item label="所属类别">
          <el-select v-model="modelForm.categoryId" placeholder="选择类别" :disabled="!!editingModel" style="width: 100%">
            <el-option v-for="cat in categories" :key="cat.id" :label="cat.name" :value="cat.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="型号名称">
          <el-input v-model="modelForm.name" placeholder="例如：P1500、A1500" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="modelDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="onSubmitModel">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listModels,
  createModel,
  updateModel,
  deleteModel,
  type VehicleCategory,
  type VehicleModel
} from '@/api/vehicles'

const categories = ref<VehicleCategory[]>([])
const models = ref<VehicleModel[]>([])
const categoryLoading = ref(false)
const modelLoading = ref(false)
const submitting = ref(false)
const categoryError = ref('')
const modelError = ref('')
const filterCategoryId = ref<number | undefined>(undefined)

const categoryDialogVisible = ref(false)
const editingCategory = ref<VehicleCategory | null>(null)
const categoryForm = reactive({ name: '' })

const modelDialogVisible = ref(false)
const editingModel = ref<VehicleModel | null>(null)
const modelForm = reactive({ categoryId: 0, name: '' })

onMounted(async () => {
  await loadCategories()
  await loadModels()
})

async function loadCategories() {
  categoryLoading.value = true
  categoryError.value = ''
  try {
    categories.value = await listCategories()
  } catch (e) {
    categoryError.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    categoryLoading.value = false
  }
}

async function loadModels() {
  modelLoading.value = true
  modelError.value = ''
  try {
    models.value = await listModels(filterCategoryId.value ? { categoryId: filterCategoryId.value } : undefined)
  } catch (e) {
    modelError.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    modelLoading.value = false
  }
}

function openCategoryDialog(row?: VehicleCategory) {
  editingCategory.value = row || null
  categoryForm.name = row?.name || ''
  categoryDialogVisible.value = true
}

async function onSubmitCategory() {
  const name = categoryForm.name.trim()
  if (!name) {
    ElMessage.error('类别名称不能为空')
    return
  }
  submitting.value = true
  try {
    if (editingCategory.value) {
      await updateCategory(editingCategory.value.id, name)
      ElMessage.success('更新成功')
    } else {
      await createCategory(name)
      ElMessage.success('创建成功')
    }
    categoryDialogVisible.value = false
    await loadCategories()
    await loadModels()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    submitting.value = false
  }
}

async function onDeleteCategory(row: VehicleCategory) {
  try {
    await ElMessageBox.confirm(`确定要删除类别 "${row.name}" 吗？`, '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'error'
    })
    await deleteCategory(row.id)
    ElMessage.success('删除成功')
    await loadCategories()
    await loadModels()
  } catch (e) {
    if (e === 'cancel' || (e instanceof Error && e.message === 'cancel')) return
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

function openModelDialog(row?: VehicleModel) {
  editingModel.value = row || null
  modelForm.categoryId = row?.category_id || (categories.value[0]?.id ?? 0)
  modelForm.name = row?.name || ''
  modelDialogVisible.value = true
}

async function onSubmitModel() {
  const name = modelForm.name.trim()
  if (!modelForm.categoryId) {
    ElMessage.error('请选择所属类别')
    return
  }
  if (!name) {
    ElMessage.error('型号名称不能为空')
    return
  }
  submitting.value = true
  try {
    if (editingModel.value) {
      await updateModel(editingModel.value.id, name)
      ElMessage.success('更新成功')
    } else {
      await createModel(modelForm.categoryId, name)
      ElMessage.success('创建成功')
    }
    modelDialogVisible.value = false
    await loadModels()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    submitting.value = false
  }
}

async function onDeleteModel(row: VehicleModel) {
  try {
    await ElMessageBox.confirm(`确定要删除型号 "${row.name}" 吗？`, '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'error'
    })
    await deleteModel(row.id)
    ElMessage.success('删除成功')
    await loadModels()
  } catch (e) {
    if (e === 'cancel' || (e instanceof Error && e.message === 'cancel')) return
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}
</script>

<style scoped>
.section-card {
  margin-bottom: 20px;
}
.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.header-actions {
  display: flex;
  align-items: center;
}
.error-alert {
  margin-bottom: 12px;
}
</style>
